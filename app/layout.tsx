import React from 'react';

export const metadata = {
  title: 'FTE Workload System',
  description: 'ระบบคำนวณภาระงาน FTE',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="th">
      <head>
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/css/bootstrap.min.css"
        />
      </head>
      <body>
        <main className="container py-4">
          {children}
        </main>
      </body>
    </html>
  );
}