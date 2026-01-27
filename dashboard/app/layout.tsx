import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'CC Dev Team',
  description: 'CC Dev Team Dashboard',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
