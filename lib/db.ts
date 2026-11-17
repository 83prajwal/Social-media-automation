import fs from "fs";
import path from "path";
import { DATA_DIR } from "./paths";
import type { Post, Product } from "./types";

interface DB {
  products: Product[];
  posts: Post[];
}

const FILE = path.join(DATA_DIR, "db.json");

// All reads/writes are synchronous, so read-modify-write cycles can't interleave
// inside the single Node process that runs the Next.js server.
function load(): DB {
  try {
    const data = JSON.parse(fs.readFileSync(FILE, "utf8"));
    return { products: data.products ?? [], posts: data.posts ?? [] };
  } catch {
    return { products: [], posts: [] };
  }
}

function save(db: DB) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const json = JSON.stringify(db, null, 2);
  const tmp = FILE + ".tmp";
  try {
    fs.writeFileSync(tmp, json);
    fs.renameSync(tmp, FILE);
  } catch {
    fs.writeFileSync(FILE, json);
  }
}

export const db = {
  listProducts(): Product[] {
    return load().products.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },
  getProduct(id: string) {
    return load().products.find((p) => p.id === id);
  },
  addProduct(p: Product) {
    const d = load();
    d.products.push(p);
    save(d);
    return p;
  },
  deleteProduct(id: string) {
    const d = load();
    d.products = d.products.filter((p) => p.id !== id);
    save(d);
  },

  listPosts(): Post[] {
    return load().posts.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },
  getPost(id: string) {
    return load().posts.find((p) => p.id === id);
  },
  addPost(p: Post) {
    const d = load();
    d.posts.push(p);
    save(d);
    return p;
  },
  updatePost(id: string, patch: Partial<Post> | ((p: Post) => Partial<Post>)) {
    const d = load();
    const i = d.posts.findIndex((p) => p.id === id);
    if (i < 0) return undefined;
    const changes = typeof patch === "function" ? patch(d.posts[i]) : patch;
    d.posts[i] = { ...d.posts[i], ...changes, updatedAt: new Date().toISOString() };
    save(d);
    return d.posts[i];
  },
  deletePost(id: string) {
    const d = load();
    d.posts = d.posts.filter((p) => p.id !== id);
    save(d);
  },
};
