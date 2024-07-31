import type { Dictionary } from '@crawlee/types';
import type { load, CheerioAPI } from 'cheerio';
import cheerio from 'cheerio';

import { tryAbsoluteURL } from './extract-urls';

export type CheerioRoot = ReturnType<typeof load>;

// NOTE: We are skipping 'noscript' since it's content is evaluated as text, instead of HTML elements. That damages the results.
const SKIP_TAGS_REGEX = /^(script|style|canvas|svg|noscript)$/i;
const BLOCK_TAGS_REGEX =
    /^(p|h1|h2|h3|h4|h5|h6|ol|ul|li|pre|address|blockquote|dl|div|fieldset|form|table|tr|select|option)$/i;

/**
 * The function converts a HTML document to a plain text.
 *
 * The plain text generated by the function is similar to a text captured
 * by pressing Ctrl+A and Ctrl+C on a page when loaded in a web browser.
 * The function doesn't aspire to preserve the formatting or to be perfectly correct with respect to HTML specifications.
 * However, it attempts to generate newlines and whitespaces in and around HTML elements
 * to avoid merging distinct parts of text and thus enable extraction of data from the text (e.g. phone numbers).
 *
 * **Example usage**
 * ```javascript
 * const text = htmlToText('<html><body>Some text</body></html>');
 * console.log(text);
 * ```
 *
 * Note that the function uses [cheerio](https://www.npmjs.com/package/cheerio) to parse the HTML.
 * Optionally, to avoid duplicate parsing of HTML and thus improve performance, you can pass
 * an existing Cheerio object to the function instead of the HTML text. The HTML should be parsed
 * with the `decodeEntities` option set to `true`. For example:
 *
 * ```javascript
 * import cheerio from 'cheerio';
 * const html = '<html><body>Some text</body></html>';
 * const text = htmlToText(cheerio.load(html, { decodeEntities: true }));
 * ```
 * @param htmlOrCheerioElement HTML text or parsed HTML represented using a [cheerio](https://www.npmjs.com/package/cheerio) function.
 * @return Plain text
 */
export function htmlToText(htmlOrCheerioElement: string | CheerioRoot): string {
    if (!htmlOrCheerioElement) return '';

    const $ =
        typeof htmlOrCheerioElement === 'function'
            ? htmlOrCheerioElement
            : cheerio.load(htmlOrCheerioElement, { decodeEntities: true });
    let text = '';

    const process = (elems: Dictionary) => {
        const len = elems ? elems.length : 0;
        for (let i = 0; i < len; i++) {
            const elem = elems[i];
            if (elem.type === 'text') {
                // Compress spaces, unless we're inside <pre> element
                let compr;
                if (elem.parent && elem.parent.tagName === 'pre') compr = elem.data;
                else compr = elem.data.replace(/\s+/g, ' ');
                // If text is empty or ends with a whitespace, don't add the leading whitespace
                if (compr.startsWith(' ') && /(^|\s)$/.test(text)) compr = compr.substring(1);
                text += compr;
            } else if (elem.type === 'comment' || SKIP_TAGS_REGEX.test(elem.tagName)) {
                // Skip comments and special elements
            } else if (elem.tagName === 'br') {
                text += '\n';
            } else if (elem.tagName === 'td') {
                process(elem.children);
                text += '\t';
            } else {
                // Block elements must be surrounded by newlines (unless beginning of text)
                const isBlockTag = BLOCK_TAGS_REGEX.test(elem.tagName);
                if (isBlockTag && !/(^|\n)$/.test(text)) text += '\n';
                process(elem.children);
                if (isBlockTag && !text.endsWith('\n')) text += '\n';
            }
        }
    };

    // If HTML document has body, only convert that, otherwise convert the entire HTML
    const $body = $('body');
    process($body.length > 0 ? $body : $.root());

    return text.trim();
}

/**
 * Extracts URLs from a given Cheerio object.
 *
 * @param $ the Cheerio object to extract URLs from
 * @param selector a CSS selector for matching link elements
 * @param baseUrl a URL for resolving relative links
 * @throws when a relative URL is encountered with no baseUrl set
 * @return An array of absolute URLs
 */
export function extractUrlsFromCheerio($: CheerioAPI, selector: string = 'a', baseUrl: string = ''): string[] {
    const base = $('base').attr('href');
    const absoluteBaseUrl = base && tryAbsoluteURL(base, baseUrl);

    if (absoluteBaseUrl) {
        baseUrl = absoluteBaseUrl;
    }

    return $(selector)
        .map((_i, el) => $(el).attr('href'))
        .get()
        .filter(Boolean)
        .map((href) => {
            // Throw a meaningful error when only a relative URL would be extracted instead of waiting for the Request to fail later.
            const isHrefAbsolute = /^[a-z][a-z0-9+.-]*:/.test(href); // Grabbed this in 'is-absolute-url' package.
            if (!isHrefAbsolute && !baseUrl) {
                throw new Error(
                    `An extracted URL: ${href} is relative and baseUrl is not set. ` +
                        'Provide a baseUrl to automatically resolve relative URLs.',
                );
            }
            return baseUrl ? tryAbsoluteURL(href, baseUrl) : href;
        })
        .filter(Boolean) as string[];
}
