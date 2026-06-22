import type { Metadata } from 'next';
import './globals.css';
import { Toaster } from 'sonner';

export const metadata: Metadata = {
  title: 'USTAAD PRO • Logic Pro for Indian Classical | ©SHANKH',
  description: 'Professional DAW for Indian Classical Music. Create, Learn & Earn.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-[#0F0C08] text-[#EDE3D3]">
        {children}
        <Toaster position="top-center" richColors closeButton />
      </body>
    </html>
  );
}
