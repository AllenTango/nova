export type PostRecord = {
  slug: string;
  body: string;
  data: {
    type: 'blog' | 'vlog' | 'gallery';
    title: string;
    date: Date;
    tags: string[];
    cover?: string;
    video?: string;
    photos?: { url: string; caption?: string }[];
    description?: string;
  };
};

const modules = import.meta.glob('../content/posts/*.{md,mdx}', { eager: true }) as Record<
  string,
  {
    frontmatter: Record<string, unknown>;
    default: unknown;
    rawContent?: () => string;
    file?: string;
  }
>;

export function getPosts(): PostRecord[] {
  return Object.entries(modules)
    .map(([path, mod]) => {
      const slug = path.split('/').pop()!.replace(/\.(md|mdx)$/i, '');
      const frontmatter = mod.frontmatter ?? {};
      const body = typeof mod.rawContent === 'function' ? mod.rawContent() : '';
      return {
        slug,
        body,
        data: {
          type: (frontmatter.type as PostRecord['data']['type']) ?? 'blog',
          title: String(frontmatter.title ?? slug),
          date: new Date(String(frontmatter.date ?? '2026-01-01')),
          tags: Array.isArray(frontmatter.tags) ? frontmatter.tags.map(String) : [],
          cover: frontmatter.cover ? String(frontmatter.cover) : undefined,
          video: frontmatter.video ? String(frontmatter.video) : undefined,
          photos: Array.isArray(frontmatter.photos)
            ? (frontmatter.photos as { url: string; caption?: string }[])
            : undefined,
          description: frontmatter.description ? String(frontmatter.description) : undefined,
        },
      };
    })
    .sort((a, b) => b.data.date.valueOf() - a.data.date.valueOf());
}

export function getPostBySlug(slug: string) {
  return getPosts().find((p) => p.slug === slug);
}
