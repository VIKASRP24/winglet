import * as Clipboard from 'expo-clipboard';
import { Lexer, type Token, type Tokens } from 'marked';
import { memo, useState, type ReactNode } from 'react';
import { Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { colors, fonts, radius } from '../lib/theme';
import { Check, Copy } from './icons';
import { tap } from './ui';

type Props = { text: string; resolveUrl?: (url: string) => string; dim?: boolean };

/** Chat-flavoured Markdown: paragraphs, headings, lists, code, quotes, tables, links, images. */
export const Markdown = memo(function Markdown({ text, resolveUrl, dim }: Props) {
  let tokens: Token[];
  try {
    tokens = new Lexer({ gfm: true, breaks: true }).lex(text || '');
  } catch {
    return <Text selectable style={[styles.p, dim && styles.dim]}>{text}</Text>;
  }
  return <View style={styles.root}>{renderBlocks(tokens, { resolveUrl, dim })}</View>;
});

type Ctx = { resolveUrl?: (url: string) => string; dim?: boolean };

function renderBlocks(tokens: Token[], ctx: Ctx): ReactNode[] {
  return tokens.map((token, i) => renderBlock(token, i, ctx)).filter(Boolean);
}

function renderBlock(token: Token, key: number, ctx: Ctx): ReactNode {
  switch (token.type) {
    case 'space':
      return null;
    case 'paragraph': {
      const t = token as Tokens.Paragraph;
      const onlyImage = t.tokens?.length === 1 && t.tokens[0].type === 'image';
      if (onlyImage) return <MdImage key={key} token={t.tokens[0] as Tokens.Image} ctx={ctx} />;
      return (
        <Text key={key} selectable style={[styles.p, ctx.dim && styles.dim]}>
          {renderInline(t.tokens ?? [], ctx)}
        </Text>
      );
    }
    case 'heading': {
      const t = token as Tokens.Heading;
      const size = t.depth === 1 ? 22 : t.depth === 2 ? 19 : 16.5;
      return (
        <Text key={key} selectable style={[styles.h, { fontSize: size, lineHeight: size * 1.3 }]}>
          {renderInline(t.tokens ?? [], ctx)}
        </Text>
      );
    }
    case 'code': {
      const t = token as Tokens.Code;
      return (
        <View key={key} style={styles.codeBlock}>
          <View style={styles.codeHead}>
            <Text style={styles.codeLang}>{t.lang || 'code'}</Text>
            <CopyButton text={t.text} />
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <Text selectable style={styles.codeText}>{t.text}</Text>
          </ScrollView>
        </View>
      );
    }
    case 'blockquote': {
      const t = token as Tokens.Blockquote;
      return (
        <View key={key} style={styles.quote}>
          <View style={styles.quoteBar} />
          <View style={{ flex: 1 }}>{renderBlocks(t.tokens ?? [], ctx)}</View>
        </View>
      );
    }
    case 'list': {
      const t = token as Tokens.List;
      const start = typeof t.start === 'number' ? t.start : 1;
      return (
        <View key={key} style={styles.list}>
          {t.items.map((item, idx) => (
            <View key={idx} style={styles.li}>
              <Text style={[styles.bullet, ctx.dim && styles.dim]}>
                {item.task ? (item.checked ? '☑' : '☐') : t.ordered ? `${start + idx}.` : '•'}
              </Text>
              <View style={{ flex: 1 }}>
                {item.tokens.map((child, ci) =>
                  child.type === 'text' ? (
                    <Text key={ci} selectable style={[styles.p, ctx.dim && styles.dim]}>
                      {renderInline((child as Tokens.Text).tokens ?? [child], ctx)}
                    </Text>
                  ) : (
                    renderBlock(child, ci, ctx)
                  ),
                )}
              </View>
            </View>
          ))}
        </View>
      );
    }
    case 'table': {
      const t = token as Tokens.Table;
      return (
        <ScrollView key={key} horizontal style={styles.tableWrap} showsHorizontalScrollIndicator={false}>
          <View>
            <View style={[styles.tr, styles.thead]}>
              {t.header.map((cell, ci) => (
                <Text key={ci} selectable style={[styles.td, styles.th]}>{renderInline(cell.tokens, ctx)}</Text>
              ))}
            </View>
            {t.rows.map((row, ri) => (
              <View key={ri} style={styles.tr}>
                {row.map((cell, ci) => (
                  <Text key={ci} selectable style={styles.td}>{renderInline(cell.tokens, ctx)}</Text>
                ))}
              </View>
            ))}
          </View>
        </ScrollView>
      );
    }
    case 'hr':
      return <View key={key} style={styles.hr} />;
    case 'html':
    case 'text':
      return (
        <Text key={key} selectable style={[styles.p, ctx.dim && styles.dim]}>
          {'tokens' in token && token.tokens ? renderInline(token.tokens, ctx) : (token as Tokens.Text).text}
        </Text>
      );
    default:
      return 'raw' in token ? <Text key={key} selectable style={styles.p}>{(token as Tokens.Generic).raw}</Text> : null;
  }
}

function renderInline(tokens: Token[], ctx: Ctx): ReactNode[] {
  return tokens.map((token, i) => {
    switch (token.type) {
      case 'strong':
        return <Text key={i} style={styles.bold}>{renderInline((token as Tokens.Strong).tokens, ctx)}</Text>;
      case 'em':
        return <Text key={i} style={styles.italic}>{renderInline((token as Tokens.Em).tokens, ctx)}</Text>;
      case 'del':
        return <Text key={i} style={styles.strike}>{renderInline((token as Tokens.Del).tokens, ctx)}</Text>;
      case 'codespan':
        return <Text key={i} style={styles.codeInline}>{decode((token as Tokens.Codespan).text)}</Text>;
      case 'br':
        return <Text key={i}>{'\n'}</Text>;
      case 'link': {
        const t = token as Tokens.Link;
        return (
          <Text key={i} style={styles.link} onPress={() => openLink(t.href)}>
            {renderInline(t.tokens ?? [], ctx)}
          </Text>
        );
      }
      case 'image': {
        const t = token as Tokens.Image;
        return <Text key={i} style={styles.link} onPress={() => openLink(ctx.resolveUrl ? ctx.resolveUrl(t.href) : t.href)}>🖼 {t.text || 'image'}</Text>;
      }
      case 'escape':
      case 'text': {
        const t = token as Tokens.Text;
        if (t.tokens?.length) return <Text key={i}>{renderInline(t.tokens, ctx)}</Text>;
        return <Text key={i}>{decode(t.text)}</Text>;
      }
      default:
        return <Text key={i}>{decode((token as Tokens.Generic).raw ?? '')}</Text>;
    }
  });
}

/** Copies the exact code block, then confirms with a check mark for a moment. */
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={copied ? 'Copied' : 'Copy code'}
      hitSlop={10}
      style={({ pressed }) => [styles.copy, pressed && { opacity: 0.6 }]}
      onPress={async () => {
        tap();
        await Clipboard.setStringAsync(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1600);
      }}
    >
      {copied ? <Check size={14} color={colors.green} /> : <Copy size={14} color={colors.textMuted} />}
      <Text style={[styles.copyText, copied && { color: colors.green }]}>{copied ? 'Copied' : 'Copy'}</Text>
    </Pressable>
  );
}

function MdImage({ token, ctx }: { token: Tokens.Image; ctx: Ctx }) {
  const uri = ctx.resolveUrl ? ctx.resolveUrl(token.href) : token.href;
  return (
    <Image
      source={{ uri }}
      style={styles.image}
      contentFit="cover"
      accessibilityLabel={token.text || 'image'}
    />
  );
}

function openLink(href: string) {
  // Only real links: agent output is untrusted, and a javascript: URL would run inside the app.
  if (!href || !/^(https?:|mailto:)/i.test(href.trim())) return;
  if (Platform.OS === 'web') globalThis.open?.(href, '_blank', 'noopener');
  else Linking.openURL(href).catch(() => undefined);
}

function decode(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

const styles = StyleSheet.create({
  root: { gap: 6 },
  p: { color: colors.textDim, fontFamily: fonts.regular, fontSize: 15.5, lineHeight: 22 },
  dim: { color: colors.textMuted },
  h: { color: colors.text, fontFamily: fonts.bold, marginTop: 4 },
  bold: { fontFamily: fonts.bold, color: colors.text },
  italic: { fontStyle: 'italic' },
  strike: { textDecorationLine: 'line-through' },
  link: { color: colors.link },
  codeInline: {
    fontFamily: fonts.mono, fontSize: 13.5, backgroundColor: colors.codeBg, color: '#E3E5E8',
    borderRadius: 4, paddingHorizontal: 4,
  },
  codeBlock: {
    backgroundColor: colors.codeBg, borderRadius: radius.md, borderWidth: 1, borderColor: colors.divider,
    padding: 12, marginVertical: 2,
  },
  codeHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  codeLang: { color: colors.textFaint, fontFamily: fonts.semibold, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.6 },
  copy: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 2, paddingHorizontal: 4 },
  copyText: { color: colors.textMuted, fontFamily: fonts.semibold, fontSize: 12 },
  codeText: { fontFamily: fonts.mono, fontSize: 13.5, lineHeight: 19, color: '#E3E5E8' },
  quote: { flexDirection: 'row', gap: 10 },
  quoteBar: { width: 4, borderRadius: 4, backgroundColor: colors.border },
  list: { gap: 4 },
  li: { flexDirection: 'row', gap: 8, paddingRight: 8 },
  bullet: { color: colors.textMuted, fontFamily: fonts.semibold, fontSize: 15, lineHeight: 22, minWidth: 14 },
  tableWrap: { borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  tr: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: colors.divider },
  thead: { backgroundColor: colors.cardRaised },
  td: { color: colors.textDim, fontFamily: fonts.regular, fontSize: 14, padding: 8, minWidth: 90, maxWidth: 260 },
  th: { fontFamily: fonts.semibold, color: colors.text },
  hr: { height: 1, backgroundColor: colors.border, marginVertical: 6 },
  image: { width: 260, height: 190, borderRadius: radius.md, backgroundColor: colors.cardRaised },
});
