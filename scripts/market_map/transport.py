"""Bounded, identified public HTTP retrieval. No paid clients or browser bypasses."""
from __future__ import annotations

from .fetch_outcomes import FetchFailure, retry_after
from http.client import HTTPException
import hashlib
import contextlib,os
import http.cookiejar
import ipaddress
import json
import re
import socket
import time
import urllib.error
import urllib.request
import urllib.robotparser
from dataclasses import dataclass
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path
from urllib.parse import urlencode, urljoin, urlsplit


class SourceBlocked(FetchFailure):
    """Access, policy, format or public-network guard requires review."""


class BudgetExceeded(FetchFailure):
    """The explicit request or byte ceiling has been reached."""


@dataclass
class Response:
    body: bytes
    headers: dict
    url: str
    status: int = 200
    from_cache: bool = False
    redirect_chain: tuple = ()

    def json(self):
        try:
            data = json.loads(self.body)
        except (json.JSONDecodeError, UnicodeError) as exc:
            raise SourceBlocked("Source returned invalid JSON: " + self.url,code="parse_error",url=self.url) from exc
        if isinstance(data, dict) and data.get("error"):
            raise SourceBlocked("Source API error: " + json.dumps(data["error"])[:500])
        return data

    def text(self):
        return self.body.decode("utf-8-sig", errors="replace")


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


class Transport:
    USER_AGENT = "SSMMarketMap/1.0 (public business-source research; bounded requests)"
    DIRECTORY_FORM_ROUTES = {
        "https://kanatacentral.com/wp-admin/admin-ajax.php": {
            "source_page": "https://kanatacentral.com/directory/",
            "actions": {
                "get_categories": {"action", "nonce"},
                "filter_stores": {"action", "nonce", "industries", "industries[]", "search", "page"},
            },
        },
    }

    def __init__(self, cache_dir=None, *, max_requests=100, max_bytes=100_000_000,
                 max_response_bytes=10_000_000, timeout=20, min_interval=.25,
                 retries=2, allowed_hosts=None, anonymous_directory_session=False,host_budget_root=None,require_host_budget=False):
        if not 1 <= max_requests <= 10000 or max_bytes < 1 or max_response_bytes < 1:
            raise ValueError("Positive bounded request/byte budgets required")
        if not 0 <= retries <= 3 or not 0 < timeout <= 60 or min_interval < 0:
            raise ValueError("Invalid retry, timeout or throttle configuration")
        from .host_budget import HostBudget
        root=host_budget_root or os.environ.get('SSM_HOST_BUDGET_ROOT')
        if require_host_budget and not root:raise SourceBlocked('Shared host budget configuration required',code='scope_denied')
        self.host_budget=HostBudget(root) if root else None
        self.cache_dir = Path(cache_dir) if cache_dir else None
        if self.cache_dir:
            self.cache_dir.mkdir(parents=True, exist_ok=True)
        self.max_requests, self.max_bytes = max_requests, max_bytes
        self.max_response_bytes, self.timeout = max_response_bytes, timeout
        self.min_interval, self.retries = min_interval, retries
        self.allowed_hosts = set(allowed_hosts or [])
        self.requests = self.bytes_fetched = self.cache_hits = 0
        self.capture_cache_hits = self.capture_reused_bytes = 0
        self.robots_checked, self._robots, self._host_last = {}, {}, {}
        self.started_at, self._started = self._stamp(), time.monotonic()
        self._directory_cookies = http.cookiejar.CookieJar() if anonymous_directory_session else None
        handlers = [_NoRedirect]
        if self._directory_cookies is not None:
            handlers.append(urllib.request.HTTPCookieProcessor(self._directory_cookies))
        self.opener = urllib.request.build_opener(*handlers)

    @staticmethod
    def _stamp():
        return datetime.now(timezone.utc).isoformat()

    def metrics(self):
        return {"requests": self.requests, "bytes_fetched": self.bytes_fetched,
                "capture_cache_hits":self.capture_cache_hits,"capture_reused_bytes":self.capture_reused_bytes,
                "cache_hits": self.cache_hits, "elapsed_seconds": round(time.monotonic()-self._started, 3),
                "estimated_cost": 0, "paid_service_calls": 0, "browser_rendered_pages": 0,
                "model_tokens": 0, "started_at": self.started_at,
                "robots_checked": self.robots_checked}

    def _guard(self, url, allowed_hosts):
        parsed = urlsplit(url)
        host = (parsed.hostname or "").lower()
        if (parsed.scheme != "https" or not host or host not in allowed_hosts
                or parsed.username or parsed.password or parsed.port not in (None, 443)):
            raise SourceBlocked("URL outside explicit HTTPS host scope: " + url,code="scope_denied",url=url)
        try:
            answers = socket.getaddrinfo(host, 443, type=socket.SOCK_STREAM)
        except OSError as exc:
            raise SourceBlocked("DNS lookup failed: " + host,code="dns_transient" if getattr(exc,"errno",None)==socket.EAI_AGAIN else "dns_unknown",url=url,retryable=getattr(exc,"errno",None)==socket.EAI_AGAIN) from exc
        if not answers or any(not ipaddress.ip_address(a[4][0]).is_global for a in answers):
            raise SourceBlocked("Non-public network target: " + host,code="private_target",url=url,policy_scope="host")
        return parsed

    @contextlib.contextmanager
    def _open_budgeted(self,request,host):
        slot=self.host_budget.slot(host,interval=self.min_interval) if self.host_budget else contextlib.nullcontext()
        with slot:
            try:
                with self.opener.open(request,timeout=self.timeout) as response:yield response
            except urllib.error.HTTPError as error:
                if self.host_budget and error.code in (429,500,502,503,504):
                    value=retry_after((error.headers or {}).get('Retry-After',''))
                    until=datetime.fromisoformat(value).timestamp() if value else time.time()+2
                    self.host_budget.defer(host,until)
                raise

    def _request(self, url, allowed_hosts, headers=None, *, check_redirect_robots=False, data=None, access_check=None):
        chain=[]
        for redirect in range(5):
            if access_check:access_check(url)
            chain.append(url)
            parsed = self._guard(url, allowed_hosts)
            host = parsed.hostname
            for attempt in range(self.retries + 1):
                if self.requests >= self.max_requests or self.bytes_fetched + self.capture_reused_bytes >= self.max_bytes:
                    raise BudgetExceeded("HTTP request/byte budget exhausted",code="budget_deferred",url=url,retryable=True,budget_reason="request_or_total_bytes")
                wait = self.min_interval - (time.monotonic() - self._host_last.get(host, 0))
                if wait > 10:
                    raise SourceBlocked("Source deferred; crawl delay exceeds this run's 10-second wait bound",code="crawl_delay_review",url=url,policy_scope="host")
                if wait > 0:
                    time.sleep(wait)
                self.requests += 1
                self._host_last[host] = time.monotonic()
                request = urllib.request.Request(url, data=data, headers={"User-Agent": self.USER_AGENT,
                    "Accept": "application/json,text/csv,text/html,*/*;q=0.5", **(headers or {})})
                try:
                    with self._open_budgeted(request,host) as response:
                        limit = min(self.max_response_bytes, self.max_bytes - self.bytes_fetched - self.capture_reused_bytes)
                        body = response.read(limit + 1)
                        self.bytes_fetched += len(body)
                        if len(body) > limit:
                            raise BudgetExceeded("Response exceeds configured byte budget",code="response_too_large" if limit==self.max_response_bytes else "budget_deferred",url=url,retryable=limit!=self.max_response_bytes,budget_reason="response_bytes" if limit==self.max_response_bytes else "total_bytes")
                        content = body[:10000].lower()
                        if any(v in content for v in (b"cf-chl-", b"verify you are human", b".well-known/sgcaptcha")):
                            raise SourceBlocked("Source access challenge; no bypass attempted",code="access_challenge",url=url,policy_scope="host")
                        return Response(body, dict(response.headers), url, response.status,redirect_chain=tuple(chain))
                except urllib.error.HTTPError as exc:
                    retry_at=retry_after((exc.headers or {}).get('Retry-After',''))
                    if exc.code == 304:
                        return Response(b"", dict(exc.headers), url, 304,redirect_chain=tuple(chain))
                    if exc.code in (301, 302, 303, 307, 308):
                        if data is not None:
                            raise SourceBlocked("Public search form redirected; inspect the offered route before retrying") from exc
                        if redirect == 4:
                            raise SourceBlocked("Redirect limit exceeded") from exc
                        next_url = urljoin(url, exc.headers.get("Location", ""))
                        self._guard(next_url, allowed_hosts)
                        if check_redirect_robots:
                            self._check_robots(next_url, allowed_hosts)
                        url = next_url
                        break
                    if exc.code in (429, 500, 502, 503, 504) and attempt < self.retries:
                        retry = exc.headers.get("Retry-After", "")
                        try:
                            delay = float(retry) if retry.isdigit() else max(0, (parsedate_to_datetime(retry)-datetime.now(timezone.utc)).total_seconds())
                        except (ValueError, TypeError):
                            delay = 2 ** attempt
                        if delay > 10:
                            raise SourceBlocked("Source deferred retry; Retry-After exceeds this run's 10-second wait bound",code="http_temporary",url=url,http_status=exc.code,retryable=True,retry_after_at=retry_at) from exc
                        time.sleep(max(0, delay))
                        continue
                    if exc.code in (404, 410):
                        return Response(b"", dict(exc.headers), url, exc.code)
                    raise SourceBlocked("HTTP %s: %s" % (exc.code, url[:300]),code="http_temporary" if exc.code in (429,500,502,503,504) else "access_denied" if exc.code in (401,403) else "http_error",url=url,http_status=exc.code,retryable=exc.code in (429,500,502,503,504),retry_after_at=retry_at,policy_scope="host" if exc.code in (401,403) else "url") from exc
                except (urllib.error.URLError, TimeoutError, OSError) as exc:
                    if attempt >= self.retries:
                        raise SourceBlocked("Network retrieval failed: " + str(exc),code="timeout" if isinstance(getattr(exc,"reason",exc),TimeoutError) else "network_failure",url=url,retryable=True) from exc
                    time.sleep(2 ** attempt)
                except HTTPException as exc:
                    raise SourceBlocked("HTTP protocol retrieval failed: " + str(exc),code="network_failure",url=url,retryable=True) from exc
            else:
                raise SourceBlocked("Retry limit exhausted")
        raise SourceBlocked("Redirect limit exhausted")

    def _check_robots(self, url, allowed_hosts):
        p = urlsplit(url)
        origin = "%s://%s" % (p.scheme, p.netloc)
        if origin not in self._robots:
            robots_url = origin + "/robots.txt"
            try:
                response = self._request(robots_url, allowed_hosts)
            except SourceBlocked as exc:
                raise SourceBlocked(str(exc),code='robots_unresolved',url=robots_url,http_status=exc.http_status,policy_scope='host') from exc
            parser = urllib.robotparser.RobotFileParser(robots_url)
            if response.status in (404, 410):
                parser.parse([])
            elif response.status == 200:
                if b"<html" in response.body[:1000].lower():
                    raise SourceBlocked("robots.txt returned HTML; access policy unresolved",code="robots_unresolved",url=robots_url,policy_scope="host")
                parser.parse(response.text().splitlines())
            else:
                raise SourceBlocked("robots.txt unavailable; access policy unresolved",code="robots_unresolved",url=robots_url,policy_scope="host")
            self._robots[origin] = parser
            self.robots_checked[p.hostname] = {"checked_at": self._stamp(), "status": response.status, "url": robots_url}
        parser = self._robots[origin]
        if not parser.can_fetch(self.USER_AGENT, url):
            raise SourceBlocked("robots.txt disallows this URL: " + url,code="robots_denied",url=url,policy_scope="url")
        delay = parser.crawl_delay(self.USER_AGENT) or parser.crawl_delay("*")
        if delay and delay > self.min_interval:
            self.min_interval = delay

    def fetch(self, url, *, allowed_hosts=None, robots=True):
        allowed = set(allowed_hosts or self.allowed_hosts)
        self._guard(url, allowed)
        if robots:
            self._check_robots(url, allowed)
        cache_path = self.cache_dir / (hashlib.sha256(url.encode()).hexdigest()+".json") if self.cache_dir else None
        cached = json.loads(cache_path.read_text()) if cache_path and cache_path.exists() else None
        headers = {}
        if cached:
            if cached["headers"].get("ETag"):
                headers["If-None-Match"] = cached["headers"]["ETag"]
            if cached["headers"].get("Last-Modified"):
                headers["If-Modified-Since"] = cached["headers"]["Last-Modified"]
        response = self._request(url, allowed, headers, check_redirect_robots=robots)
        if response.status == 304 and cached:
            self.cache_hits += 1
            return Response(bytes.fromhex(cached["body_hex"]), cached["headers"], cached["url"], 200, True)
        if response.status != 200:
            raise SourceBlocked("HTTP %s: %s" % (response.status, url),code="http_missing" if response.status in (404,410) else "http_error",http_status=response.status,url=url)
        # Do not archive whole websites. Only cache structured public payloads.
        content_type = response.headers.get("Content-Type", "").lower()
        if cache_path and any(kind in content_type for kind in ("json", "csv", "spreadsheet", "excel")):
            record = {"body_hex": response.body.hex(), "headers": response.headers,
                      "url": response.url, "fetched_at": self._stamp()}
            temp = cache_path.with_suffix(".tmp")
            temp.write_text(json.dumps(record))
            temp.replace(cache_path)
        return response

    def fetch_capture(self,url,*,allowed_hosts,validators=None,access_check=None):
        """Revalidate source access even for a cached body; HTTP 304 is explicit."""
        if self._directory_cookies is not None:
            raise SourceBlocked('Shared capture requires a stateless anonymous transport',code='scope_denied',url=url)
        allowed=set(allowed_hosts)
        if access_check:access_check(url)
        self._guard(url,allowed)
        # A previous robots decision cannot hide a changed policy on this invocation.
        self._robots.clear()
        self._check_robots(url,allowed)
        response=self._request(url,allowed,validators or {},check_redirect_robots=True,access_check=access_check)
        if response.status not in (200,304):
            raise SourceBlocked('HTTP %s: %s'%(response.status,url),code='http_missing' if response.status in (404,410) else 'http_error',http_status=response.status,url=url)
        return response

    def fetch_public_form(self, url, fields, *, documentation_url):
        """Submit an explicitly published anonymous read-only search/pagination form.

        Callers must review the publisher's actual client/form and policies first.
        This is intentionally separate from GET caching; never replays a POST to a
        redirect, login, token endpoint, or a different host.
        """
        allowed = set(self.allowed_hosts)
        target = self._guard(url, allowed)
        documentation = self._guard(documentation_url, allowed)
        if target.hostname != documentation.hostname:
            raise SourceBlocked("Public form documentation must be on its publisher host")
        if not isinstance(fields, dict) or not fields or any(
                not isinstance(k, str) or not isinstance(v, (str, int)) for k, v in fields.items()):
            raise ValueError("Explicit scalar public form fields required")
        data = urlencode(fields).encode("ascii")
        if len(data) > 32768:
            raise BudgetExceeded("Public form request exceeds32KiB bound")
        self._check_robots(url, allowed)
        response = self._request(url, allowed, {"Content-Type": "application/x-www-form-urlencoded"},
                                 check_redirect_robots=True, data=data)
        if response.status != 200:
            raise SourceBlocked("HTTP %s: %s" % (response.status, url),code="http_missing" if response.status in (404,410) else "http_error",http_status=response.status,url=url)
        return response

    def fetch_directory_form(self, url, fields, *, operation_context):
        """Reviewed anonymous directory listing UI only; never a general form.

        Exact source/action/keys/purpose and payload bounds are checked before
        calling the public-form primitive. Robots and all public-network/HTTP
        budgets remain mandatory. Anonymous cookies stay in this instance's
        memory. No redirect replays, sign-in, contact or account actions exist.
        """
        route = self.DIRECTORY_FORM_ROUTES.get(url)
        if not route or not isinstance(fields, dict) or not isinstance(operation_context, dict):
            raise SourceBlocked("Directory form route/operation is not explicitly reviewed")
        if (operation_context.get("kind") != "public_directory_listing"
                or operation_context.get("source_page_url") != route["source_page"]):
            raise SourceBlocked("Directory form requires exact documented read-only operation context")
        if self._directory_cookies is None:
            raise SourceBlocked("Directory forms require an explicit anonymous in-memory session")
        action = fields.get("action")
        keys = route["actions"].get(action) if isinstance(action, str) else None
        if not keys or not set(fields).issubset(keys) or not {"action", "nonce"}.issubset(fields):
            raise SourceBlocked("Directory form action/keys are not explicitly reviewed")
        nonce = fields.get("nonce")
        if not isinstance(nonce, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,128}", nonce):
            raise SourceBlocked("Directory form anonymous nonce format differs")
        if "search" in fields and (not isinstance(fields["search"], str) or len(fields["search"]) > 200):
            raise SourceBlocked("Directory form search exceeds reviewed bounds")
        if "page" in fields and (isinstance(fields["page"], bool) or not str(fields["page"]).isdigit() or not 1 <= int(fields["page"]) <= 10000):
            raise SourceBlocked("Directory form page exceeds reviewed bounds")
        encoded = dict(fields)
        for key in ("industries", "industries[]"):
            if key in fields:
                if not isinstance(fields[key], (list, tuple)) or fields[key]:
                    raise SourceBlocked("This reviewed directory route collects only the full unfiltered roster")
                encoded.pop(key)  # Ordinary jQuery omits empty selected arrays.
        if len(urlencode(encoded).encode("ascii")) > 2048:
            raise SourceBlocked("Directory form encoded payload exceeds reviewed 2048-byte bound")
        response = self.fetch_public_form(url, encoded, documentation_url=route["source_page"])
        # Session values are neither persisted nor returned for receipt logging.
        headers = {key: value for key, value in response.headers.items()
                   if key.casefold() not in {"set-cookie", "cookie", "authorization"}}
        return Response(response.body, headers, response.url, response.status, response.from_cache)
