import { MetadataRoute } from "next";

// Private, password-gated app — keep it out of search engines. (Doesn't affect
// the real access-control story, which is the middleware password gate — see
// lib/auth.ts — but there's no reason to invite crawlers either.)
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", disallow: "/" },
  };
}
