import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'OPENSTOKO',
  description: 'OPENSTOKO: The Intelligent Warehouse Operating System'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
