export default function PageTransition({ page, children }) {
  return <main key={page} className="page-transition">{children}</main>
}