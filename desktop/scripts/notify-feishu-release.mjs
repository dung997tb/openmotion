import { createHmac } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);

const ALLOWED_FEISHU_HOSTS = new Set(['open.feishu.cn', 'open.larksuite.com']);

export function validateFeishuWebhookUrl(rawUrl) {
  const trimmed = String(rawUrl ?? '').trim();
  if (!trimmed) {
    throw new Error('Feishu webhook URL is empty');
  }
  const parsed = new URL(trimmed);
  if (parsed.protocol !== 'https:' || !ALLOWED_FEISHU_HOSTS.has(parsed.hostname)) {
    throw new Error(`Unsupported Feishu webhook host: ${parsed.origin}`);
  }
  if (!parsed.pathname.startsWith('/open-apis/bot/v2/hook/')) {
    throw new Error(`Unexpected Feishu webhook path: ${parsed.pathname}`);
  }
  return parsed.toString();
}

export function signFeishuWebhook(secret, timestampSeconds) {
  const stringToSign = `${timestampSeconds}\n${secret}`;
  return createHmac('sha256', stringToSign).digest('base64');
}

function escapeLarkMarkdown(raw) {
  return String(raw ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&#60;')
    .replace(/>/g, '&#62;')
    .replace(/\*/g, '&#42;')
    .replace(/_/g, '&#95;')
    .replace(/~/g, '&#126;')
    .replace(/`/g, '&#96;');
}

function makeDownloadButton({ label, url, primary = false }) {
  return {
    tag: 'button',
    text: { tag: 'plain_text', content: label },
    type: primary ? 'primary_filled' : 'default',
    size: 'medium',
    width: 'fill',
    icon: { tag: 'standard_icon', token: 'download_outlined' },
    behaviors: [
      {
        type: 'open_url',
        default_url: url,
        pc_url: url,
        ios_url: url,
        android_url: url,
      },
    ],
  };
}

export function buildDesktopReleaseCardPayload({
  channel,
  version,
  buildVersion,
  publicOrigin = 'https://releases.open-design.ai',
  branch = '',
  commitSha = '',
  commitSubject = '',
  actor = '',
  runUrl = '',
  includeMacX64 = true,
  secret = '',
  timestampSeconds = Math.floor(Date.now() / 1000),
}) {
  const normalizedChannel = channel === 'stable' ? 'stable' : 'test';
  const origin = String(publicOrigin || 'https://releases.open-design.ai').replace(/\/+$/, '');
  const baseUrl = `${origin}/open-motion/desktop/${normalizedChannel}`;
  const shortSha = commitSha ? String(commitSha).slice(0, 8) : '';
  const isStable = normalizedChannel === 'stable';

  const arm64Dmg = `${baseUrl}/OpenDesign-${version}-mac-arm64.dmg`;
  const x64Dmg = `${baseUrl}/OpenDesign-${version}-mac-x64.dmg`;
  const winSetup = `${baseUrl}/OpenDesign-Setup-${version}-win-x64.exe`;
  const winPortable = `${baseUrl}/OpenDesign-Portable-${version}-win-x64.exe`;

  const themeColor = isStable ? 'green' : 'blue';
  const badgeText = isStable ? 'STABLE' : 'TEST';
  const title = isStable ? 'OpenDesign 客户端正式版发布' : 'OpenDesign 客户端新版本发布';
  const subtitleParts = [`v${version}`];
  if (buildVersion) subtitleParts.push(`Build ${buildVersion}`);
  if (branch) subtitleParts.push(branch);

  const infoColumns = [
    {
      tag: 'column',
      width: 'weighted',
      weight: 1,
      vertical_spacing: '2px',
      elements: [
        { tag: 'markdown', content: "<font color='grey'>版本</font>", text_size: 'notation', margin: '0px' },
        { tag: 'markdown', content: `**v${escapeLarkMarkdown(version)}**`, text_size: 'normal', margin: '0px' },
      ],
    },
    {
      tag: 'column',
      width: 'weighted',
      weight: 1,
      vertical_spacing: '2px',
      elements: [
        { tag: 'markdown', content: "<font color='grey'>分支</font>", text_size: 'notation', margin: '0px' },
        {
          tag: 'markdown',
          content: `**${escapeLarkMarkdown(branch || normalizedChannel)}**`,
          text_size: 'normal',
          margin: '0px',
        },
      ],
    },
    {
      tag: 'column',
      width: 'weighted',
      weight: 1,
      vertical_spacing: '2px',
      elements: [
        { tag: 'markdown', content: "<font color='grey'>提交</font>", text_size: 'notation', margin: '0px' },
        {
          tag: 'markdown',
          content: `**${escapeLarkMarkdown(shortSha || 'manual')}**`,
          text_size: 'normal',
          margin: '0px',
        },
      ],
    },
  ];

  const summaryInnerElements = [
    {
      tag: 'column_set',
      flex_mode: 'none',
      horizontal_spacing: '12px',
      columns: infoColumns,
      margin: '0px',
    },
  ];

  if (commitSubject || actor) {
    const summaryText = [
      commitSubject ? escapeLarkMarkdown(String(commitSubject).trim()) : '',
      actor ? `<font color='grey'>· ${escapeLarkMarkdown(actor)}</font>` : '',
    ]
      .filter(Boolean)
      .join(' ');
    summaryInnerElements.push({
      tag: 'markdown',
      content: `<font color='grey'>变更内容：</font>${summaryText}`,
      text_size: 'notation',
      margin: '4px 0px 0px 0px',
    });
  }

  const footerParts = [
    `<font color='grey'>${
      isStable
        ? '已安装正式版客户端将通过自动更新推送此版本'
        : '已安装 Test 频道客户端会自动检测更新，无需重复安装'
    }</font>`,
  ];
  if (runUrl) {
    footerParts.push(`[查看 CI 构建详情](${runUrl})`);
  }

  const elements = [
    {
      tag: 'column_set',
      flex_mode: 'none',
      background_style: 'grey-50',
      margin: '0px 0px 12px 0px',
      columns: [
        {
          tag: 'column',
          width: 'weighted',
          weight: 1,
          padding: '10px 12px',
          vertical_spacing: '4px',
          elements: summaryInnerElements,
        },
      ],
    },
    {
      tag: 'markdown',
      content: "**选择平台下载** <font color='grey'>macOS 已签名公证</font>",
      text_size: 'normal',
      margin: '0px 0px 8px 0px',
    },
    {
      tag: 'column_set',
      flex_mode: 'none',
      horizontal_spacing: '8px',
      margin: '0px 0px 8px 0px',
      columns: includeMacX64
        ? [
            {
              tag: 'column',
              width: 'weighted',
              weight: 1,
              elements: [
                makeDownloadButton({
                  label: 'macOS · Apple Silicon',
                  url: arm64Dmg,
                  primary: true,
                }),
              ],
            },
            {
              tag: 'column',
              width: 'weighted',
              weight: 1,
              elements: [
                makeDownloadButton({
                  label: 'macOS · Intel (x64)',
                  url: x64Dmg,
                }),
              ],
            },
          ]
        : [
            {
              tag: 'column',
              width: 'weighted',
              weight: 1,
              elements: [
                makeDownloadButton({
                  label: '下载 macOS (Apple Silicon)',
                  url: arm64Dmg,
                  primary: true,
                }),
              ],
            },
          ],
    },
    {
      tag: 'column_set',
      flex_mode: 'none',
      horizontal_spacing: '8px',
      margin: '0px 0px 12px 0px',
      columns: [
        {
          tag: 'column',
          width: 'weighted',
          weight: 1,
          elements: [
            makeDownloadButton({
              label: 'Windows · 安装版',
              url: winSetup,
            }),
          ],
        },
        {
          tag: 'column',
          width: 'weighted',
          weight: 1,
          elements: [
            makeDownloadButton({
              label: 'Windows · 便携版',
              url: winPortable,
            }),
          ],
        },
      ],
    },
    {
      tag: 'markdown',
      content: footerParts.join('　·　'),
      text_size: 'notation',
      margin: '0px',
    },
  ];

  const payload = {
    msg_type: 'interactive',
    card: {
      schema: '2.0',
      config: {
        update_multi: true,
        width_mode: 'default',
        summary: {
          content: `[${badgeText}] OpenDesign v${version} 已发布`,
        },
      },
      header: {
        title: { tag: 'plain_text', content: title },
        subtitle: { tag: 'plain_text', content: subtitleParts.join(' · ') },
        template: themeColor,
        icon: { tag: 'standard_icon', token: 'ai-common_colorful' },
        text_tag_list: [
          {
            tag: 'text_tag',
            text: { tag: 'plain_text', content: badgeText },
            color: themeColor,
          },
        ],
      },
      body: {
        direction: 'vertical',
        padding: '12px 12px 16px 12px',
        vertical_spacing: '0px',
        elements,
      },
    },
  };

  if (secret) {
    const ts = String(timestampSeconds);
    payload.timestamp = ts;
    payload.sign = signFeishuWebhook(secret, ts);
  }

  return payload;
}

export async function sendFeishuReleaseNotification({
  webhookUrl,
  secret = '',
  fetchImpl = fetch,
  ...releaseInfo
}) {
  const safeUrl = validateFeishuWebhookUrl(webhookUrl);
  const payload = buildDesktopReleaseCardPayload({ ...releaseInfo, secret });
  const response = await fetchImpl(safeUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15_000),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Feishu webhook returned HTTP ${response.status}: ${text.slice(0, 300)}`);
  }
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`Feishu webhook returned non-JSON response: ${text.slice(0, 300)}`);
  }
  const code = body?.code ?? body?.StatusCode ?? 0;
  if (code !== 0) {
    throw new Error(`Feishu webhook rejected payload (code=${code}): ${body?.msg ?? body?.StatusMessage ?? text}`);
  }
  return { ok: true, response: body };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  const webhookUrl = process.env.FEISHU_WEBHOOK_URL?.trim();
  if (!webhookUrl) {
    console.log('FEISHU_WEBHOOK_URL not configured; skipping Feishu desktop release notification.');
    process.exit(0);
  }

  const runUrl =
    process.env.GITHUB_SERVER_URL && process.env.GITHUB_REPOSITORY && process.env.GITHUB_RUN_ID
      ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
      : '';

  await sendFeishuReleaseNotification({
    webhookUrl,
    secret: process.env.FEISHU_WEBHOOK_SECRET?.trim() || '',
    channel: process.env.CHANNEL || process.env.OPENMOTION_RELEASE_CHANNEL || 'test',
    version: process.env.EXPECTED_VERSION || process.env.RELEASE_VERSION || '',
    buildVersion: process.env.RELEASE_BUILD_VERSION || '',
    publicOrigin: process.env.RELEASE_PUBLIC_ORIGIN || 'https://releases.open-design.ai',
    branch: process.env.GITHUB_REF_NAME || '',
    commitSha: process.env.GITHUB_SHA || '',
    commitSubject: process.env.COMMIT_SUBJECT || '',
    actor: process.env.GITHUB_ACTOR || '',
    runUrl,
    includeMacX64: process.env.INCLUDE_MAC_X64 !== 'false',
  });
  console.log('Sent Feishu desktop release notification.');
}
