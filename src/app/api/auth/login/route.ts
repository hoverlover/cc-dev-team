import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

/**
 * Initiate GitHub OAuth flow via Supabase Auth.
 */
export async function GET(request: Request) {
  const { origin } = new URL(request.url)

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'github',
    options: {
      redirectTo: `${origin}/api/auth/callback`,
      scopes: 'read:user user:email'
    }
  })

  if (error || !data.url) {
    return NextResponse.json(
      { error: error?.message || 'Failed to initiate OAuth' },
      { status: 500 }
    )
  }

  return NextResponse.redirect(data.url)
}
