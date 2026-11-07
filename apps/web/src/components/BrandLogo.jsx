export default function BrandLogo({ className = 'w-8 h-8', title = 'Quarry logo' }) {
  return <img src="/favicon.svg" alt={title} className={className} draggable="false" />
}
