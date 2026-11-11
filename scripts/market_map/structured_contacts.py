"""Bounded, document-local schema contacts. Candidate edges are never verification."""
from .schema_types import ORGANIZATION_TYPES

VERSION='ssm-structured-contacts/1'

EXCLUDED={'JobPosting','Review','Article','BlogPosting','NewsArticle'}


def types_of(node):
    value=node.get('@type',[])
    return {v.removeprefix('https://schema.org/').removeprefix('http://schema.org/')
            for v in (value if isinstance(value,list) else [value]) if isinstance(v,str)}


def walk_contact_graph(value, *, max_nodes=5000, max_depth=30):
    nodes=[];definitions={};over_budget=False;visited=0
    def visit(item,pointer='',depth=0,excluded=False,contact_parent=None):
        nonlocal over_budget,visited
        visited+=1
        if depth>max_depth or visited>max_nodes:over_budget=True;return
        if isinstance(item,list):
            for i,child in enumerate(item):visit(child,pointer+'/'+str(i),depth+1,excluded,contact_parent)
        elif isinstance(item,dict):
            excluded=excluded or bool(types_of(item)&EXCLUDED)
            nodes.append((pointer,item,excluded,contact_parent))
            if isinstance(item.get('@id'),str) and len(set(item)-{'@id','@context'})>0:
                definitions.setdefault(item['@id'],[]).append(pointer)
            for key,child in item.items():
                if isinstance(child,(list,dict)) and key!='@context':
                    visit(child,pointer+'/'+key.replace('~','~0').replace('/','~1'),depth+1,excluded,
                          pointer if key=='contactPoint' else None)
    visit(value)
    if over_budget:return []
    by_pointer={p:(n,e,parent) for p,n,e,parent in nodes}
    def target(item,pointer):
        if not isinstance(item,dict):return None
        if '@id' in item:
            refs=definitions.get(item['@id'],[]) if isinstance(item['@id'],str) else []
            return refs[0] if len(refs)==1 else None
        return pointer if pointer in by_pointer else None
    edges={};incoming={}
    for p,n,excluded,parent in nodes:
        if excluded:continue
        for field in ('contactPoint','worksFor'):
            raw=n.get(field,[]);items=raw if isinstance(raw,list) else [raw]
            for i,item in enumerate(items):
                pointer=p+'/'+field+('/'+str(i) if isinstance(raw,list) else '')
                t=target(item,pointer)
                if t is not None:
                    edges.setdefault(p,[]).append(t)
                    if field=='contactPoint' and types_of(n)&(ORGANIZATION_TYPES|{'Person'}):incoming.setdefault(t,[]).append(p)
    def cyclic(start):
        # Bounded reachability; ambiguous large graphs abstain rather than recurse forever.
        todo=list(edges.get(start,[]));seen=set()
        while todo:
            p=todo.pop()
            if p==start:return True
            if p in seen:continue
            seen.add(p)
            if len(seen)>max_nodes:return True
            todo.extend(edges.get(p,[]))
        return False
    def candidate(pointer):
        n,e,parent=by_pointer[pointer]
        return {'json_pointer':pointer,'id':n.get('@id'),'name':n.get('name'),'types':sorted(types_of(n)),
                'address':n.get('address'),'contactType':n.get('contactType'),'status':'explicit_document_node_not_verified'}
    output=[]
    for p,n,excluded,parent in nodes:
        kinds=types_of(n)
        allowed=bool(kinds&(ORGANIZATION_TYPES|{'Person','ContactPoint'})) or parent in incoming.get(p,[])
        phone_only=not allowed
        ambiguous=(isinstance(n.get('@id'),str) and len(definitions.get(n['@id'],[]))!=1) or cyclic(p)
        owner_pointers=incoming.get(p,[]) if 'ContactPoint' in kinds or parent is not None else [p]
        owners=[] if phone_only or excluded else [candidate(q) for q in sorted(set(owner_pointers)) if not by_pointer[q][1]]
        if any(cyclic(q) or (isinstance(by_pointer[q][0].get('@id'),str) and len(definitions.get(by_pointer[q][0]['@id'],[]))!=1) for q in owner_pointers):ambiguous=True
        status='explicit_document_edge_not_verified' if len(owners)==1 and not ambiguous else 'unresolved'
        employers=[]
        raw=n.get('worksFor',[])
        for i,item in enumerate(raw if isinstance(raw,list) else [raw]):
            t=target(item,p+'/worksFor'+('/'+str(i) if isinstance(raw,list) else ''))
            if t is not None and types_of(by_pointer[t][0])&ORGANIZATION_TYPES and not by_pointer[t][1] and not cyclic(t):employers.append(candidate(t))
        metadata={'node_pointer':p,'node':candidate(p),'candidate_owners':owners,'ownership_status':status,
                  'candidate_employers':employers if not ambiguous else [],'ambiguity_review_required':ambiguous or len(owners)!=1,'excluded_context':excluded}
        if not phone_only and not excluded and 'Person' in kinds and isinstance(n.get('jobTitle'),str):
            output.append({**metadata,'channel':'person','value':n.get('name'),'job_title':n['jobTitle'],'json_pointer':p})
        for field in ('telephone','faxNumber') if phone_only else ('email','telephone','faxNumber'):
            raw=n.get(field,[])
            for i,item in enumerate(raw if isinstance(raw,list) else [raw]):
                if isinstance(item,str) or (field!='email' and isinstance(item,int)):
                    output.append({**metadata,'channel':field,'value':item,'json_pointer':p+'/'+field+('/'+str(i) if isinstance(raw,list) else '')})
    return output
