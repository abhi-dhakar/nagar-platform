import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Renders untrusted repository Markdown (READMEs). Raw HTML in the source is shown as text,
 * `javascript:` and other unsafe URL schemes are dropped by react-markdown's URL transform, and
 * external links open without handing the page a reference to the opener.
 */
export function MarkdownBody({ children }: { children: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        a: ({ node: _node, href, children: label, ...props }) => (
          <a {...props} href={href} rel="noopener noreferrer nofollow" target="_blank">
            {label}
          </a>
        ),
      }}
    >
      {children}
    </ReactMarkdown>
  );
}
