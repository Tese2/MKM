import { assetUrl } from './services/api.js';

const defaultProductImages = [
  'https://images.unsplash.com/photo-1579621970563-ebec7560ff3e?auto=format&fit=crop&w=900&q=80',
  'https://images.unsplash.com/photo-1559526324-593bc073d938?auto=format&fit=crop&w=900&q=80',
  'https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3?auto=format&fit=crop&w=900&q=80',
  'https://images.unsplash.com/photo-1579621970795-87facc2f976d?auto=format&fit=crop&w=900&q=80',
  'https://images.unsplash.com/photo-1604594849809-dfedbc827105?auto=format&fit=crop&w=900&q=80',
  'https://images.unsplash.com/photo-1563013544-824ae1b704d3?auto=format&fit=crop&w=900&q=80',
  'https://images.unsplash.com/photo-1526304640581-d334cdbbf45e?auto=format&fit=crop&w=900&q=80',
  'https://images.unsplash.com/photo-1534951009808-766178b47a4f?auto=format&fit=crop&w=900&q=80',
];

export function getProductImage(product) {
  if (product?.imageUrl) return assetUrl(product.imageUrl);
  const order = Number(product?.displayOrder ?? 1);
  const index = Number.isFinite(order) && order > 0 ? Math.floor(order - 1) : 0;
  return defaultProductImages[index % defaultProductImages.length];
}
