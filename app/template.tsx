// Re-mounted on every navigation, so each page arrives with the same short rise.
export default function Template({ children }: { children: React.ReactNode }) {
  return <div className="page-in">{children}</div>;
}
