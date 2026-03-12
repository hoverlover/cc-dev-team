import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

/**
 * Supabase Auth callback handler.
 * GitHub OAuth redirects here after user authorizes.
 * Exchanges the auth code for a session.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const next = searchParams.get('next') ?? '/workbench'

  if (!code) {
    return NextResponse.redirect(`${origin}/auth/error?message=Missing+auth+code`)
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  const { error } = await supabase.auth.exchangeCodeForSession(code)

  if (error) {
    console.error('[Auth Callback] Code exchange failed:', error.message)
    return NextResponse.redirect(`${origin}/auth/error?message=${encodeURIComponent(error.message)}`)
  }

  return NextResponse.redirect(`${origin}${next}`)
}
