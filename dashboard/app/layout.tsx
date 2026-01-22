import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Agentic Orchestrator Dashboard',
  description: 'Multi-agent orchestration system dashboard',
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
