export default function GlassSurface({ as: Element = 'div', className = '', children, ...props }) {
  return <Element className={`glass-surface ${className}`.trim()} {...props}>{children}</Element>
}