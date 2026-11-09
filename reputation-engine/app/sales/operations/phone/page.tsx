'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { loadTwilioVoiceSdk } from '@/lib/twilio-voice-sdk'
import { InCallKeypad } from '@/app/components/in-call-keypad'
import { OPERATIONS_NUMBER, operationsPhone, type OperationsContact, type OperationsEvent } from '@/lib/operations-phone'

type Call = { on:(event:string,fn:(...args:any[])=>void)=>void; accept:()=>void; reject:()=>void; disconnect:()=>void; mute:(muted:boolean)=>void; status:()=>string; sendDigits:(digits:string)=>void; parameters:Record<string,string>; customParameters?:Map<string,string> }
type Device = { on:(event:string,fn:(...args:any[])=>void)=>void; register:()=>Promise<void>; updateToken:(token:string)=>void; connect:(options:{params:{To:string}})=>Promise<Call>; destroy:()=>void }
async function api(path:string,body?:unknown) {
  const response = await fetch(`/api/sales/operations/${path}`,body ? {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)} : {cache:'no-store'})
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || 'Request failed. Please retry.')
  return data
}
const button = 'rounded-lg bg-[#123f36] px-4 py-2 text-sm font-semibold text-white disabled:opacity-40'
const secondary = 'rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium disabled:opacity-40'
const field = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm'
export default function OperationsPhonePage() {
  const [contacts,setContacts] = useState<OperationsContact[]>([]), [threads,setThreads] = useState<OperationsEvent[]>([])
  const [selected,setSelected] = useState(''), [search,setSearch] = useState(''), [events,setEvents] = useState<OperationsEvent[]>([]), [more,setMore] = useState(false)
  const [error,setError] = useState(''), [notice,setNotice] = useState(''), [draft,setDraft] = useState(''), [note,setNote] = useState(''), [media,setMedia] = useState<string[]>([]), [sending,setSending] = useState(false), [uploading,setUploading] = useState(false)
  const [editing,setEditing] = useState<OperationsContact|null>(null), [saving,setSaving] = useState(false)
  const [ready,setReady] = useState(false), [connecting,setConnecting] = useState(false), [callState,setCallState] = useState('idle'), [callPhone,setCallPhone] = useState(''), [muted,setMuted] = useState(false)
  const device = useRef<Device|null>(null), call = useRef<Call|null>(null), alive = useRef(true), busy = useRef(false), selectedRef = useRef(''), generation = useRef(0)
  const refresh = useCallback(async () => { const data = await api('phone'); if (alive.current) {setContacts(data.contacts);setThreads(data.threads)} },[])
  const load = useCallback(async (phone:string,offset=0) => {
    const data = await api(`phone?phone=${encodeURIComponent(phone)}&offset=${offset}`)
    if (!alive.current || selectedRef.current !== phone) return
    setEvents(previous => offset ? [...previous,...data.events.filter((e:OperationsEvent)=>!previous.some(p=>p.id===e.id))] : data.events);setMore(data.hasMore)
  },[])
  useEffect(() => {
    alive.current=true
    const initialParams=new URLSearchParams(window.location.search), initialPhone=operationsPhone(initialParams.get('phone'))
    if(initialPhone){select(initialPhone);setDraft((initialParams.get('draft')||'').slice(0,1600))}
    void refresh().catch(e=>setError(e.message))
    const timer=setInterval(()=>{void refresh().catch(()=>{});if(selectedRef.current) void load(selectedRef.current).catch(()=>{})},15000)
    const leave=(e:BeforeUnloadEvent)=>{if(busy.current){e.preventDefault();e.returnValue=''}}
    const navigate=(e:MouseEvent)=>{const a=(e.target as Element)?.closest('a');if(busy.current && a && a.getAttribute('href')?.startsWith('/') && !a.getAttribute('href')?.startsWith('/api/')){if(!window.confirm('Leaving Operations Phone will end your call. Leave?')){e.preventDefault();e.stopPropagation()}}}
    window.addEventListener('beforeunload',leave);document.addEventListener('click',navigate,true)
    return ()=>{alive.current=false;generation.current++;clearInterval(timer);device.current?.destroy();device.current=null;window.removeEventListener('beforeunload',leave);document.removeEventListener('click',navigate,true)}
  },[refresh,load])
  function select(phone:string) { selectedRef.current=phone;setSelected(phone);setEvents([]);setMore(false);setDraft('');setNote('');setMedia([]);void load(phone).catch(e=>setError(e.message)) }
  function ended(current:Call) {if(call.current!==current)return;call.current=null;busy.current=false;setCallState('idle');setMuted(false);void refresh().catch(()=>{});if(selectedRef.current)void load(selectedRef.current).catch(()=>{})}
  function attach(current:Call,phone:string,incoming:boolean) {
    call.current=current;busy.current=true;setCallPhone(phone);setCallState(incoming?'incoming':'calling');setMuted(false)
    current.on('accept',()=>setCallState('connected'))
    current.on('disconnect',()=>ended(current));current.on('cancel',()=>ended(current));current.on('reject',()=>ended(current))
    current.on('error',(e:Error)=>{setError(e.message || 'Call failed');ended(current)})
    current.on('reconnecting',()=>setNotice('Call reconnecting…'));current.on('reconnected',()=>setNotice('Call reconnected.'))
  }
  async function enable() {
    if (connecting || busy.current) return
    setConnecting(true);setError('');const version=++generation.current
    try {
      device.current?.destroy();device.current=null;setReady(false)
      await loadTwilioVoiceSdk();const token=await api('token')
      if (!alive.current || version!==generation.current) return
      const Constructor=window.Twilio?.Device as unknown as new(token:string,options:Record<string,unknown>)=>Device
      if(!Constructor)throw new Error('Voice SDK could not load. Refresh and retry.')
      const d=new Constructor(token.token,{codecPreferences:['opus','pcmu'],tokenRefreshMs:60000});device.current=d
      d.on('registered',()=>{if(alive.current)setReady(true)})
      d.on('unregistered',()=>{if(alive.current)setReady(false)})
      d.on('error',(e:Error)=>{if(alive.current){setError(e.message || 'Phone connection failed');setReady(false)}})
      d.on('tokenWillExpire',()=>{void api('token').then(t=>d.updateToken(t.token)).catch(e=>{setError(e.message);setReady(false)})})
      d.on('incoming',(incoming:Call)=>{if(busy.current){incoming.reject();return}const phone=operationsPhone(incoming.customParameters?.get('OperationsPhone') || incoming.parameters.From);attach(incoming,phone,true);if(phone)select(phone)})
      await d.register()
    } catch(e) {setError(e instanceof Error?e.message:'Unable to enable phone')} finally {if(alive.current)setConnecting(false)}
  }
  async function dial() {
    if(!ready || !device.current || busy.current || !selected)return
    busy.current=true;setCallPhone(selected);setCallState('calling');setError('')
    try {const current=await device.current.connect({params:{To:selected}});attach(current,selected,false)} catch(e){busy.current=false;setCallState('idle');setError(e instanceof Error?e.message:'Call failed')}
  }
  async function send() {
    if(sending || uploading)return
    setSending(true);setError('');const target=selected
    try {const result=await api('send-sms',{to:target,body:draft,mediaUrls:media});if(selectedRef.current===target){setDraft('');setMedia([])}setNotice(result.warning || 'Message accepted for delivery.');await load(target);await refresh()}catch(e){setError(e instanceof Error?e.message:'Unable to send')}finally{setSending(false)}
  }
  async function upload(file?:File) {
    if(!file)return;setUploading(true);setError('');const target=selected
    try {const body=new FormData();body.append('file',file);const r=await fetch('/api/sales/operations/upload-media',{method:'POST',body});const data=await r.json();if(!r.ok)throw new Error(data.error);if(target===selectedRef.current)setMedia(m=>[...m,data.url])}catch(e){setError(e instanceof Error?e.message:'Upload failed')}finally{setUploading(false)}
  }
  async function saveContact() {
    if(!editing || saving)return;setSaving(true);setError('')
    try {await api('phone',editing);const phone=operationsPhone(editing.phone);setEditing(null);await refresh();select(phone)}catch(e){setError(e instanceof Error?e.message:'Save failed')}finally{setSaving(false)}
  }
  const contact=contacts.find(c=>c.phone===selected), latest=new Map(threads.map(t=>[t.phone,t]))
  const filtered=contacts.filter(c=>`${c.name} ${c.company} ${c.phone}`.toLowerCase().includes(search.toLowerCase())).sort((a,b)=>(latest.get(b.phone)?.created_at || '').localeCompare(latest.get(a.phone)?.created_at || '') || a.name.localeCompare(b.name))
  return <main className="mx-auto max-w-7xl space-y-5 pb-10">
    <header className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-widest text-emerald-700">Subcontractors & vendors</p><h1 className="mt-1 text-3xl font-bold text-slate-900">Operations Phone</h1><p className="mt-2 text-slate-600">226-774-6581 · Shared calls, texts and recordings</p></div><div className="space-y-2 text-right"><button className={button} disabled={connecting || callState!=='idle' || ready} onClick={()=>void enable()}>{ready?'Phone ready':connecting?'Connecting…':'Enable Operations phone'}</button><p className="max-w-xs text-xs text-slate-500">Keep this page open to receive calls. Unanswered calls forward to Operations mobile.</p></div></header>
    {error && <div role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}<button className="ml-4 underline" onClick={()=>setError('')}>Dismiss</button></div>}
    {notice && <div role="status" className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900">{notice}<button className="ml-4 underline" onClick={()=>setNotice('')}>Dismiss</button></div>}
    {callState!=='idle' && <section aria-label="Operations call" className="rounded-xl bg-[#123f36] p-5 text-white"><div className="flex flex-wrap items-center justify-between gap-4"><div><p className="text-sm">{callState==='incoming'?'Incoming Operations call':callState==='connected'?'Connected · Recording enabled':'Calling from 226-774-6581'}</p><p className="text-xl font-bold">{contacts.find(c=>c.phone===callPhone)?.name || callPhone}</p></div><div className="flex gap-2">{callState==='incoming'?<button className={secondary+' text-slate-900'} onClick={()=>{try{call.current?.accept()}catch(e){setError(String(e))}}}>Answer</button>:<button className={secondary+' text-slate-900'} onClick={()=>{call.current?.mute(!muted);setMuted(!muted)}}>{muted?'Unmute':'Mute'}</button>}<button className="rounded-lg bg-red-600 px-4 py-2 font-semibold" onClick={()=>{if(callState==='incoming')call.current?.reject();else call.current?.disconnect()}}>{callState==='incoming'?'Decline':'End call'}</button></div></div><div className="mt-3 rounded-lg bg-white p-2 text-slate-900"><InCallKeypad getCall={()=>call.current} blocked={callState!=='connected'}/></div></section>}
    {editing && <section className="space-y-3 rounded-xl border bg-white p-5"><h2 className="font-semibold">Operations contact</h2><div className="grid gap-3 sm:grid-cols-2"><input aria-label="Contact phone" className={field} placeholder="Phone number" value={editing.phone} onChange={e=>setEditing({...editing,phone:e.target.value})}/><select aria-label="Contact type" className={field} value={editing.type} onChange={e=>setEditing({...editing,type:e.target.value as OperationsContact['type']})}><option value="subcontractor">Subcontractor</option><option value="vendor">Vendor</option></select><input aria-label="Contact name" className={field} placeholder="Contact name" value={editing.name} onChange={e=>setEditing({...editing,name:e.target.value})}/><input aria-label="Company" className={field} placeholder="Company" value={editing.company} onChange={e=>setEditing({...editing,company:e.target.value})}/></div><button className={button} disabled={saving} onClick={()=>void saveContact()}>Save contact</button> <button className={secondary} onClick={()=>setEditing(null)}>Cancel</button></section>}
    <div className="grid min-h-[560px] overflow-hidden rounded-xl border bg-white lg:grid-cols-[320px_1fr]">
      <aside className="border-b bg-slate-50 p-4 lg:border-b-0 lg:border-r"><div className="flex items-center justify-between"><h2 className="font-semibold">Contacts & conversations</h2><button className="text-sm font-semibold text-emerald-800" onClick={()=>setEditing({phone:'',name:'',company:'',type:'subcontractor'})}>+ New</button></div><input aria-label="Search Operations contacts" className={field+' mt-3'} placeholder="Search name, company or number" value={search} onChange={e=>setSearch(e.target.value)}/><div className="mt-3 max-h-[560px] space-y-1 overflow-y-auto">{filtered.map(c=><button key={c.phone} className={`w-full rounded-lg p-3 text-left ${selected===c.phone?'bg-emerald-100':'hover:bg-white'}`} onClick={()=>select(c.phone)}><div className="font-semibold">{c.name || c.company || c.phone}</div><div className="text-xs text-slate-600">{c.company ? c.company+' · ':''}{c.phone}</div><div className="mt-1 truncate text-xs text-slate-500">{latest.get(c.phone)?.payload.body || (latest.get(c.phone)?.kind==='call'?'Phone call':'No conversation yet')}</div></button>)}{!filtered.length&&<p className="p-3 text-sm text-slate-500">Add a subcontractor or vendor to start a conversation.</p>}</div></aside>
      <section className="min-w-0 p-5">{!selected?<div className="py-24 text-center text-slate-500">Choose a contact or add a new one.<p className="mt-2 text-sm">Every call and text here uses 226-774-6581.</p></div>:<><div className="flex flex-wrap items-center justify-between gap-3 border-b pb-4"><div><h2 className="text-xl font-bold">{contact?.name || selected}</h2><p className="text-sm text-slate-500">{contact?.company} · {contact?.type || 'Operations contact'} · {selected}</p></div><div className="flex gap-2"><button className={secondary} onClick={()=>setEditing(contact || {phone:selected,name:'',company:'',type:'subcontractor'})}>Edit contact</button><button className={button} disabled={!ready || callState!=='idle'} onClick={()=>void dial()}>Call from 6581</button></div></div>
      <div className="my-4 max-h-[450px] space-y-3 overflow-y-auto" aria-label="Conversation history">{more&&<button className={secondary} onClick={()=>void load(selected,events.length).catch(e=>setError(e.message))}>Load older history</button>}{[...events].reverse().map(event=><article key={event.id} className={`rounded-lg border p-3 ${event.direction==='outbound'?'ml-6 bg-emerald-50':event.kind==='note'?'bg-amber-50':'mr-6 bg-slate-50'}`}><div className="mb-2 flex flex-wrap justify-between gap-2 text-xs text-slate-500"><span>{event.kind==='note'?'Internal note':event.kind==='call'?(event.payload.voicemail?'Voicemail':`${event.direction} call`):`${event.direction} text`}{event.payload.repName?' · '+event.payload.repName:''}</span><time>{new Date(event.created_at).toLocaleString()}</time></div>{event.payload.body&&<p className="whitespace-pre-wrap break-words text-sm">{event.payload.body}</p>}{event.payload.mediaUrls?.map((url,i)=><a className="mr-3 text-sm text-emerald-800 underline" key={url} href={`/api/sales/operations/media?id=${encodeURIComponent(event.id)}&index=${i}`} target="_blank" rel="noreferrer">Attachment {i+1}</a>)}{event.kind==='call'&&<p className="text-sm">{event.payload.status}{event.payload.duration?` · ${Math.floor(event.payload.duration/60)}m ${event.payload.duration%60}s`:''}</p>}{event.payload.recordingSid&&<audio className="mt-3 w-full" controls preload="none" src={`/api/sales/operations/recording?id=${encodeURIComponent(event.id)}`}/>} {event.payload.transcript&&<details className="mt-2 text-sm"><summary className="cursor-pointer font-semibold">Transcript</summary><p className="mt-2 whitespace-pre-wrap">{event.payload.transcript}</p></details>}{event.payload.transcriptionStatus==='processing'&&<p className="mt-2 text-xs text-slate-500">Transcript processing…</p>}{event.payload.transcriptionStatus==='unavailable'&&<p className="mt-2 text-xs text-slate-500">Transcript unavailable; recording is available above.</p>}{event.kind==='sms'&&<p className="mt-2 text-xs text-slate-500">{event.payload.status}{event.payload.errorCode?` · Carrier error ${event.payload.errorCode}`:''}</p>}</article>)}{!events.length&&<p className="py-6 text-sm text-slate-500">No messages or calls yet.</p>}</div>
      <div className="space-y-3 border-t pt-4"><label className="block text-sm font-semibold" htmlFor="operations-message">Text from 226-774-6581</label><textarea id="operations-message" className={field} rows={3} maxLength={1600} placeholder="Message this subcontractor or vendor…" value={draft} onChange={e=>setDraft(e.target.value)}/><div className="flex flex-wrap items-center justify-between gap-3"><label className={secondary+' cursor-pointer'}>{uploading?'Uploading…':'Attach file'}<input className="hidden" aria-label="Attach file" type="file" accept="image/jpeg,image/png,image/gif,application/pdf" disabled={uploading || sending || media.length>=10} onChange={e=>{void upload(e.target.files?.[0]);e.target.value=''}}/></label><button className={button} disabled={sending||uploading||(!draft.trim()&&!media.length)} onClick={()=>void send()}>{sending?'Sending…':'Send text'}</button></div>{media.length>0&&<button className="text-sm underline" onClick={()=>setMedia([])}>{media.length} attachment(s) · Remove</button>}<details className="pt-2"><summary className="cursor-pointer text-sm font-semibold">Add internal note</summary><textarea aria-label="Internal note" className={field+' mt-2'} value={note} onChange={e=>setNote(e.target.value)}/><button className={secondary+' mt-2'} disabled={!note.trim() || saving} onClick={async()=>{setSaving(true);try{await api('phone',{action:'note',phone:selected,body:note});setNote('');await load(selected)}catch(e){setError(e instanceof Error?e.message:'Note failed')}finally{setSaving(false)}}}>Save note</button></details></div></> }</section>
    </div>
  </main>
}
