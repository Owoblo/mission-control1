// Trusted pure fixture tests only; block Node network APIs, not an OS sandbox.
import net from 'node:net';import tls from 'node:tls';import http from 'node:http';import https from 'node:https';import dgram from 'node:dgram';import dns from 'node:dns';import {syncBuiltinESMExports} from 'node:module';
const blocked=()=>{throw new Error('offline test: network forbidden')};
globalThis.fetch=blocked;net.connect=blocked;net.createConnection=blocked;net.Socket.prototype.connect=blocked;tls.connect=blocked;
http.request=blocked;http.get=blocked;https.request=blocked;https.get=blocked;dgram.createSocket=blocked;
for(const key of ['lookup','resolve','resolve4','resolve6','resolveMx','reverse']){dns[key]=blocked;if(dns.promises[key])dns.promises[key]=blocked;}
syncBuiltinESMExports();
