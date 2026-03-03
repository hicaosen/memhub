/**
 * Slugify utility - Converts strings to URL-friendly slugs
 */

/**
 * Converts a string to a URL-friendly slug
 * - Converts to lowercase
 * - Replaces spaces with hyphens
 * - Removes special characters
 * - Collapses multiple hyphens
 * - Trims leading/trailing hyphens
 *
 * @param input - The string to convert
 * @returns The slugified string
 */
export function slugify(input: string): string {
  if (!input || input.trim().length === 0) {
    return 'untitled';
  }

  // Convert to lowercase and replace non-alphanumeric characters with hyphens
  const slug = input
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '') // Remove special characters
    .replace(/\s+/g, '-') // Replace spaces with hyphens
    .replace(/-+/g, '-') // Collapse multiple hyphens
    .replace(/^-+|-+$/g, ''); // Trim leading/trailing hyphens

  // If empty after cleaning (e.g., only special characters), return 'untitled'
  if (slug.length === 0) {
    return 'untitled';
  }

  // Truncate to max 100 characters
  if (slug.length > 100) {
    return slug.substring(0, 100).replace(/-+$/, ''); // Don't end with hyphen
  }

  return slug;
}

/**
 * Generates a unique slug by appending a timestamp or counter if needed
 *
 * @param title - The title to slugify
 * @param existingSlugs - Array of existing slugs to check against
 * @returns A unique slug
 */
export function generateUniqueSlug(title: string, existingSlugs: readonly string[] = []): string {
  const slug = slugify(title);
  let counter = 1;
  let uniqueSlug = slug;

  while (existingSlugs.includes(uniqueSlug)) {
    const suffix = `-${counter}`;
    const maxBaseLength = 100 - suffix.length;
    const baseSlug = slug.substring(0, maxBaseLength).replace(/-+$/, '');
    uniqueSlug = `${baseSlug}${suffix}`;
    counter++;
  }

  return uniqueSlug;
}
