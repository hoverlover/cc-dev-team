import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

/**
 * Sign out and clear session.
 */
export async function POST(request: Request) {
  const { origin } = new URL(request.url)
  const authHeader = request.headers.get('authorization')
  const token = authHeader?.replace('Bearer ', '')

  if (token) {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { global: { headers: { Authorization: `Bearer ${token}` } } }
    )
    await supabase.auth.signOut()
  }

  return NextResponse.redirect(`${origin}/`, { status: 303 })
}
