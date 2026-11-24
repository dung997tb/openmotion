export const templateContributionUrl = 'https://github.com/nexu-io/openmotion/blob/main/CONTRIBUTING.md';

export type ContributionKind = 'template' | 'brand-kit' | 'skill';

export const contributionGuideUrls: Record<ContributionKind, string> = {
  template: `${templateContributionUrl}#submit-a-template-with-your-agent`,
  'brand-kit': `${templateContributionUrl}#submit-a-brand-kit`,
  skill: `${templateContributionUrl}#submit-a-skill-with-your-agent`,
};

/** Paste-ready Agent brief matching the corresponding section of CONTRIBUTING.md. */
export function contributionSubmissionPrompt(kind: ContributionKind, locale = 'en'): string {
  const guideUrl = contributionGuideUrls[kind];
  if (kind === 'template') {
    if (locale === 'zh-CN') return `请基于我提供的视频、参考或可编辑工程，整理一个可复用、可编辑的 OpenMotion 模板并准备贡献。先阅读 ${guideUrl} 及其关联的模板目录贡献指南。参考视频走 video-to-template 流程，已有工程保留可编辑源码。包含预览、可替换内容、TEMPLATE.md、动效指南、准确的来源署名与素材许可，按目录指南登记条目与多语言信息，并执行适用的模板及存储检查。准备面向 nexu-io/openmotion 的聚焦 PR，标题与描述使用英文，展示模板与校验结果供我评审。不要合并或发布软件包或 CMS 内容。`;
    return `Create a reusable OpenMotion template from the video or project I provide. Read ${guideUrl} and the linked template catalog contribution guide. Use the OpenMotion video-to-template workflow for a reference video; preserve editable source for an existing project. Include a preview, replaceable content, TEMPLATE.md, motion guidance, source attribution and asset licenses. Register catalog entries and locale metadata only as described in the catalog guide. Run the applicable template and storage checks. Prepare a focused pull request against nexu-io/openmotion with an English title and description, and show me the template and validation results for review. Do not merge or publish packages or CMS content.`;
  }
  if (kind === 'brand-kit') {
    if (locale === 'zh-CN') return `请基于我提供的公开网站或本地 Brand Kit 工程包，整理一个可贡献给 OpenMotion 的 Brand Kit。先阅读 ${guideUrl} 与 docs/brand-kits.md。包含原始来源、授权与许可说明、可复用的设计 token 与品牌素材，以及固定展示片的预览；将该包标记为 brand-kit 和 style-only。移除任何私有上下文文件或规则，执行包校验，准备面向 nexu-io/openmotion 的聚焦 PR（标题与描述使用英文），并附上来源引用、校验与预览证据供我评审。不要合并或发布任何内容。`;
    return `Prepare a Brand Kit contribution for OpenMotion from the public website or local Brand Kit Motion Package I provide. Read ${guideUrl} and docs/brand-kits.md first. Include the original source, permission and license notes, reusable design tokens and brand assets, and a preview of the fixed showcase. Mark the package as brand-kit and style-only, keep private context files and rules out of the contribution, and run package validation. Prepare a focused pull request against nexu-io/openmotion with an English title and description, source references, validation results and preview evidence for my review. Do not merge or publish anything.`;
  }
  if (locale === 'zh-CN') return `请将我提供的 Agent Skill（本地含 SKILL.md 的目录或公开 GitHub 仓库）贡献给 OpenMotion。先阅读 ${guideUrl} 和 library/ENTRY_TEMPLATE.md。确认这是我编写的 Skill 或其许可允许再分发；记录作者、原始 URL 或版本以及代码与素材许可，如有不明确的地方先停下来向我确认。从 nexu-io/openmotion 最新 main 创建分支，将 Skill 放到 library/skills/<name>/SKILL.md（含 name/description frontmatter、清晰触发词、步骤与真实示例），在同一目录保留 references 和 scripts 并按提交清单补齐 README.md，在 library/README.md 的 Skills 行建立链接。不要修改 skills/、Studio、MCP 注册表或发布文件清单。向 nexu-io/openmotion 提交一个英文标题与描述的草稿 PR（写明来源与许可），然后把链接发给我。不要合并或发布任何内容。`;
  return `Contribute the Agent skill I provide (a local SKILL.md folder or a public GitHub repository) to OpenMotion. Read ${guideUrl} and library/ENTRY_TEMPLATE.md first. Confirm that I wrote the skill or that its license allows redistribution; record the author, original URL or version and the licenses of its code and media, and stop to ask me if any of this is unclear. Fork nexu-io/openmotion and branch from the latest main. Put the skill at library/skills/<name>/SKILL.md with name and description frontmatter, a clear trigger, steps and a real usage example; keep its references and scripts in the same folder and add a README.md from the entry checklist. Link the entry from the Skills row of library/README.md. Do not change skills/, Studio, the MCP registry or the distribution file list. Open a draft pull request against nexu-io/openmotion with an English title and description that state the source and license, then send me the link. Do not merge or publish anything.`;
}

/** Keep the selected template and environment-specific handoff intact. */
export function templateSubmissionPrompt(recreatePrompt: string, locale = 'en'): string {
  if (locale === 'zh-CN') return `${recreatePrompt}\n\n在本次制作之外，将结果整理为可复用、可编辑的 OpenMotion 模板，准备贡献。先阅读 ${templateContributionUrl} 及其关联的模板贡献指南。包含可编辑源码、预览、改编说明、准确的来源署名与素材许可，执行适用的模板及存储检查。准备面向 nexu-io/openmotion 的聚焦 PR，标题与描述使用英文，展示结果供我评审。不要合并或发布软件包或 CMS 内容。`;
  return `${recreatePrompt}\n\nCreate a reusable, editable template from this recreation and prepare it for contribution to OpenMotion. Read ${templateContributionUrl} and the linked template catalog contribution guide first. Include editable source, a preview, adaptation instructions, accurate source attribution and asset licenses; run the applicable template and storage checks. Prepare a focused pull request against nexu-io/openmotion with an English title and description, and show me the result for review. Do not merge or publish packages or CMS content.`;
}
