import { messageLinkParts } from '@/lib/message-links'

export function MessageText({ text }: { text: string }) {
  return <>{messageLinkParts(text).map((part, index) => part.href
    ? <a key={index} href={part.href} target="_blank" rel="noopener noreferrer" className="break-all font-medium underline underline-offset-2 hover:opacity-80" onClick={event => event.stopPropagation()}>{part.text}</a>
    : <span key={index}>{part.text}</span>)}</>
}
