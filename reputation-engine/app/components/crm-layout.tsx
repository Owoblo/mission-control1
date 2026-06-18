import type { ReactNode } from 'react'

export function CRMAppFrame({ children }: { children: ReactNode }) {
  return <div className="crm-app-frame">{children}</div>
}

export function CRMMainViewport({ children }: { children: ReactNode }) {
  return <div className="crm-main-viewport">{children}</div>
}

export function CRMMainContent({
  children,
  flush = false,
}: {
  children: ReactNode
  flush?: boolean
}) {
  return <main className={flush ? 'crm-main-content-flush' : 'crm-main-content'}>{children}</main>
}

export function CRMViewport({
  children,
  flush = false,
}: {
  children: ReactNode
  flush?: boolean
}) {
  return <div className={flush ? 'crm-viewport-flush' : 'crm-viewport'}>{children}</div>
}

export function CRMRecordLayout({ children, id }: { children: ReactNode; id?: string }) {
  return <div id={id} className="crm-record-layout">{children}</div>
}

export function CRMRecordContext({ children }: { children: ReactNode }) {
  return <div className="crm-record-context">{children}</div>
}

export function CRMRecordMain({ children, id }: { children: ReactNode; id?: string }) {
  return <div id={id} className="crm-record-main">{children}</div>
}

export function CRMRecordWidget({ children }: { children: ReactNode }) {
  return <aside className="crm-record-widget">{children}</aside>
}
