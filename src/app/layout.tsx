import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Voice Agent',
  description: 'AI-powered voice assistant with real-time conversation',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
