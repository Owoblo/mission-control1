"""Literal inline runs with original-tree segment provenance; no layout inference."""
import re

INLINE={'span','b','i','em','strong','small','code','u','s','sup','sub'}
EXCLUDED={'script','style','template','noscript','head'}

def hidden(node):
    return any(n.tag in EXCLUDED or n.get('hidden') is not None or n.get('aria-hidden')=='true' or
               re.search(r'display\s*:\s*none|visibility\s*:\s*hidden',n.get('style',''),re.I)
               for n in [node,*node.iterancestors()] if isinstance(n.tag,str))

def boundary(node):
    return (node.tag not in INLINE or any(k in node.attrib for k in ('class','id','itemscope','itemtype','itemprop','role')) or
            any(k.startswith('data-') for k in node.attrib) or
            re.search(r'display|position|float|order|direction|content',node.get('style',''),re.I))

def iter_contact_text_runs(document, *, max_chars=4096, max_segments=128):
    tree=document.getroottree()
    for root in document.iter():
        if not isinstance(root.tag,str) or hidden(root):continue
        if root is not document and not boundary(root):continue
        # Unknown layout on a container is not evidence of visual adjacency.
        if re.search(r'display\s*:\s*(?:flex|grid)|position|float|order|direction',root.get('style',''),re.I):continue
        parts=[];segments=[];size=0;overflow=False
        def flush():
            nonlocal parts,segments,size,overflow
            result={'text':''.join(parts),'segments':segments,'source_dom_locator':tree.getpath(root),'node':root} if parts and not overflow else None
            parts=[];segments=[];size=0;overflow=False
            return result
        def append(text,node,field):
            nonlocal size,overflow
            if not text:return
            if size+len(text)>max_chars or len(segments)>=max_segments:overflow=True;return
            segments.append({'source_dom_locator':tree.getpath(node),'field':field,'start':size,'end':size+len(text)})
            parts.append(text);size+=len(text)
        def visit(node):
            append(node.text,node,'text')
            for child in node:
                if not isinstance(child.tag,str) or hidden(child) or boundary(child):
                    value=flush()
                    if value:yield value
                else:yield from visit(child)
                append(child.tail,child,'tail')
        yield from visit(root)
        value=flush()
        if value:yield value
