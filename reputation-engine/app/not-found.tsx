import Link from 'next/link'

// Root not-found boundary — branded 404 for any unmatched route,
// replacing Next's default page.
export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#F7F4ED] px-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 text-center shadow-xl">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-[#071421] text-2xl font-black text-[#C99700]">
          S
        </div>
        <h1 className="mt-5 text-xl font-bold tracking-tight text-[#071421]">Page not found</h1>
        <p className="mt-2 text-sm leading-6 text-[#071421]/60">
          The page you are looking for does not exist or was moved. Check the address, or head back to the dashboard.
        </p>
        <div className="mt-6">
          <Link
            href="/sales"
            className="flex min-h-[44px] items-center justify-center rounded-lg bg-[#071421] px-4 text-sm font-bold text-white hover:bg-[#071421]"
          >
            Back to dashboard
          </Link>
        </div>
      </div>
    </div>
  )
}
