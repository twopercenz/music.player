import "./globals.css";
import cx from "classnames";
import { sfPro, inter } from "./fonts";

export const metadata = {
  title: "Music Player",
  description: "A personal music player.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body className={cx(sfPro.variable, inter.variable, "bg-black")}>{children}</body>
    </html>
  );
}
