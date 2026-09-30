import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { RepositoryNav } from "./repository-nav";

test("links every repository area and marks the current one", () => {
  const html = renderToStaticMarkup(
    <RepositoryNav username="ada" repository="engine" active="commits" />,
  );
  for (const href of [
    "/ada/engine",
    "/ada/engine/commits",
    "/ada/engine/branches",
    "/ada/engine/issues",
    "/ada/engine/pulls",
    "/ada/engine/settings",
  ]) {
    assert.match(html, new RegExp(`href="${href}"`), href);
  }
  assert.equal(html.match(/aria-current="page"/g)?.length, 1);
  assert.match(html, /class="active" aria-current="page"[^>]*>Commits/);
});

test("shows counts when given and encodes path segments", () => {
  const html = renderToStaticMarkup(
    <RepositoryNav
      username="a b"
      repository="c/d"
      active="pulls"
      counts={{ pulls: 3, issues: 12 }}
    />,
  );
  assert.match(html, /href="\/a%20b\/c%2Fd\/pulls"/);
  assert.match(html, /Pull requests<span>3<\/span>/);
  assert.match(html, /Issues<span>12<\/span>/);
});
