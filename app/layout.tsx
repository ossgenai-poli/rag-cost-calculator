import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AWS RAG Price Calculator",
  description:
    "Engineer-mode monthly cost estimator for Retrieval-Augmented-Generation on AWS (OpenSearch Serverless MVP).",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
