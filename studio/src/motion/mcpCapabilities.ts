import { clipMoveInstruction, clipMoveLimits } from '../../../shared/clip-move-guide.ts';
import { creativeStudios } from '../../../shared/studio-catalog.ts';
import { reviewCommentsPrompt } from '../../../shared/review-comments.ts';
import { templateSearchBrief } from '../../../shared/template-search-brief.ts';
import { assetNamingInstruction } from '../../../shared/asset-names.ts';
import { defaultPlatformExportTarget, platformExportPrompt } from '../../../shared/platform-export.ts';
import { templateGuideContinuationInstruction } from '../../../shared/template-guide.ts';
import { designBriefPrompt } from '../../../shared/design-project.ts';
import type { IntegrationInfo } from '../../../shared/integration.ts';

/** Maintained product descriptions; coverage is checked against the public MCP contract (22 domain tools). */
export const mcpCapabilities = [
  { id: 'timeline-hover', icon: 'play-fill', title: 'Inspect timeline frames', description: 'Pause playback, then hover over the ruler or clips to inspect a silent frame preview. Click the ruler to jump there. No model or export is needed. Moving away closes it; if loading fails, move away and try again.', tools: ['openmotion_open_preview'], prompt: 'Open the existing project with openmotion_open_preview so I can hover over the timeline to inspect frames, then click the ruler to jump. Preserve the source and selection; do not export or generate media.' },
  { id: 'fullscreen', icon: 'fullscreen-line', title: 'Fullscreen playback', description: 'Watch the video with the player fullscreen button or F; Esc returns to editing. Position and editor zoom are preserved. Embedded hosts may block browser fullscreen.', tools: ['openmotion_open_preview'], prompt: 'Open this project with openmotion_open_preview. I will enter fullscreen from the player. Preserve the project; do not render or edit it.' },
  { id: 'canvas-captions', icon: 'layout-2-line', title: 'Canvas and caption controls', description: "Change the current canvas from the timeline and use CC On / Off. No model is required. First enabling creates an empty caption track; adding captions fills it. Locked tracks must be unlocked. Conflicts require reloading the latest project. Framing uses letterbox or center crop, without automatic subject detection.", tools: ['openmotion_edit_project', 'openmotion_assets_use'], prompt: 'Read this project and its current revision/version. Use openmotion_edit_project with canvas={compositionPath:"index.html",ratio:"9:16",fit:"contain"} to change the canvas. Then reread the revision/version and enable captions with openmotion_assets_use(action=transcript, transcript.command=caption_toggle, visible=true, compositionPath="index.html"). Use a stable requestId for each operation. Preserve content, respect locked tracks and stop to reread after conflicts. Open the saved preview and verify the canvas and C1 track. This needs no model and creates no transcript or invented captions.' },
  { id: 'editing', icon: 'text', title: 'Edit text and captions', description: 'Add text or manual captions at the playhead without a model. Import music, trim or split clips, or import SRT/VTT subtitles directly. For constant-speed source edits, update playback rate and duration together, preserving the source in-point and respecting linked members, locks and ripple placement.', tools: ['openmotion_assets_use', 'openmotion_import_assets', 'openmotion_edit_project'], prompt: 'Add an editable title and manual captions to this project using caption_add, preserving its existing clips. Read the current project revision first. Use explicitly supplied timing, and ask if timing or text is missing.' },
  { id: 'clip-move', icon: 'text', title: 'Move a cloud timeline clip', description: clipMoveLimits, tools: ['openmotion_get_project', 'openmotion_edit_project'], prompt: clipMoveInstruction },
  { id: 'transcript', icon: 'clipboard-line', title: 'From speech to platform versions', description: 'Import SRT/VTT subtitles, edit captions and prepare multilingual platform versions now. Automated cloud speech recognition jobs are scheduled for Phase 2 (501 FEATURE_DEFERRED_P2).', tools: ['openmotion_assets_use', 'openmotion_manage_project', 'openmotion_edit_project', 'openmotion_export_request'], prompt: 'Help me turn my source media into reviewed transcripts, editable captions and platform versions. First identify my source project, check available caption tracks or SRT/VTT imports, and ask which subtitle languages and platforms I need.' },
  { id: 'projects', icon: 'folder-open-line', title: 'Manage workspace projects', description: 'Rename, duplicate, trash, restore and permanently delete projects in your cloud workspace with optimistic revision checks.', tools: ['openmotion_manage_project'], prompt: 'Duplicate this project as an independent editable copy.' },
  { id: 'sharing', icon: 'folder-open-line', title: 'Share editable projects', description: 'Export and import editable project ZIP archives through cloud object storage. Importing always creates independent copies.', tools: ['openmotion_project_archive'], prompt: 'Export all my OpenMotion projects as a ZIP for offline sharing.' },
  { id: 'create', icon: 'clapperboard-line', title: 'From an idea to an editable film', description: 'Turn an idea or reference into motion graphics, product films and ads. Keep an editable project you can return to.', tools: ['openmotion_create_project', 'openmotion_edit_project'], prompt: 'Create a 15-second product film with three scenes, animated typography and an editable project. Ask me for the product and brand first.' },
  { id: 'templates', icon: 'layout-grid-line', title: 'Start with a template', description: 'Browse editable templates, brand references and creative guides. Ask your Agent to adapt a template or rebuild a reference for your brand.', tools: ['openmotion_list_templates', 'openmotion_get_template'], prompt: 'Show me OpenMotion templates for a product launch. Explain which are editable projects and which are references before creating anything. For an editable template, create an independent project; if opening fails, retry that exact project rather than making another copy. For a reference, read its guidance and ask for my content before authoring. Copying from the library does not send a message or create a film.' },
  { id: 'skills', icon: 'book-open-line', title: 'Find a video Skill by scenario', description: 'Search every OpenMotion video Skill, such as de-AI copy, growth teardowns or long-to-short cuts, without installing it first. Your Agent reads the Skill’s instructions and follows them to make an editable project. Skills already installed in your Agent keep working as before.', tools: ['openmotion_list_skills', 'openmotion_get_skill'], prompt: 'Recommend two or three OpenMotion Skills for turning a long talk into short clips. Use openmotion_list_skills, give each a one-line reason, and wait for my choice. Then read it with openmotion_get_skill and follow its SKILL.md; use only the supporting files it lists and verify downloads before running them. Ask for my source video before creating a project.' },
  { id: 'media', icon: 'sparkling-line', title: 'Generate images, video, music and voice', description: 'Choose a scene or filter compatible models on the unified OpenDesign Model Gateway under Image, Video or Audio. Generate directly to S3 content-addressed storage in Assets—no third-party BYOK API keys required.', tools: ['openmotion_media_use'], prompt: 'Help me generate media with OpenMotion. First inspect my media gateway with openmotion_media_use action=inspect. Check account mediaEntitlement as well as availability. If the OpenDesign Model Gateway is available, continue with my original request or ask what image, video, music or voice I want to generate, or what reference video I want to recreate. If unavailable or signed out, use openmotion_open_preview with target=providers and entry=agent_media_handbook (or agent_media_signed_out) and follow its handoff to open Model gateway. Guide me to sign in with OpenDesign under Settings > Account (Plus or above includes multimodal generation on OpenDesign Cloud; Free and Go do not), then ask me to confirm once ready. If account mediaEntitlement is not-included, use openmotion_open_preview with target=providers and entry=agent_media_handbook (or agent_media_upgrade_free / agent_media_upgrade_go) and follow its page handoff, then guide me to Subscription & usage > Manage subscription for OpenDesign Plus or above. Only when signed in (account available=true) with mediaEntitlement unknown, continue model discovery. Signed-out or expired sessions omit this hint and need sign-in setup. After I confirm, inspect again and resume my original request when the gateway is available. Read the selected provider guide and model schema, explain the model and cost before generating, then track the original job.' },
  { id: 'library', icon: 'folder-open-line', title: 'Create and reuse cloud assets', description: 'Upload via presigned S3 tickets or generate images, video and audio in Assets through the OpenDesign Model Gateway. Track async jobs, resume interrupted tasks without regenerating, read exact versions and import chosen assets into your films.', tools: ['openmotion_assets_use', 'openmotion_assets'], prompt: 'For an interrupted cloud generation job, use openmotion_assets_use action=resume with its original jobId and a stable requestId; keep the original prompt and model and do not generate again. List my OpenMotion asset library. Help me generate a new asset or edit an existing version, keep the original, read the exact version to inspect its media, then import the chosen version into my project.' },
  { id: 'assets', icon: 'folder-open-line', title: 'Import material via cloud modes', description: 'Import images, video, audio and fonts into a project using three cloud modes: presigned upload ticket (prepare_upload + upload_ticket), SSRF-checked public HTTPS URL, or zero-copy workspace library_asset. Local host file paths are unsupported in cloud mode.', tools: ['openmotion_import_assets'], prompt: 'Import my media into this project using openmotion_import_assets in cloud mode: call action=prepare_upload to get a presigned upload ticket, upload the file, then commit via upload_ticket (or pass a public HTTPS url or workspace library_asset). Check per-item results and keep font licenses with the project.' },
  { id: 'preview', icon: 'play-fill', title: 'Edit together in the same Studio', description: 'Preview and refine your Agent’s work in Studio, or ask the Agent to keep editing the same project.', tools: ['openmotion_get_project', 'openmotion_open_preview'], prompt: 'Read my current OpenMotion project and open its latest editable preview. Keep the project identity and verify the visible result before continuing. For a new video generation round, use openmotion_open_preview action=begin before authoring. When the video artifact is ready, call action=complete_generation with workId, requestId, expectedRevision and expectedVersionId immediately, including background creation. Then continue to preview or export as requested.' },
  { id: 'history', icon: 'history-line', title: 'Keep every creative direction', description: 'Browse saved versions and restore an earlier direction as a new version. Keep the history while you refine the result.', tools: ['openmotion_list_versions', 'openmotion_restore_version'], prompt: 'List versions of my OpenMotion project and explain the differences. Wait for me to choose before restoring a version.' },
  { id: 'export', icon: 'download-2-line', title: 'Deliver a finished video', description: 'Render MP4 videos asynchronously on dedicated render workers with automatic technical verification, download timeline captions as SRT/VTT, or prepare a platform version while keeping the editable project.', tools: ['openmotion_export_request', 'openmotion_export_cancel', 'openmotion_assets_use'], prompt: 'Read the selected project with openmotion_get_project. Export the agreed version with openmotion_export_request using versionId, expectedRevision, a stable requestId and the correct audio policy. Use compositionPath only when I select an existing scene; otherwise export the full video. Follow the same job and verify playback. For subtitles, call openmotion_assets_use with action=transcript and command=caption_export, projectId, compositionPath and format=srt or vtt. It exports saved visible timeline captions, including manual edits, without an ASR model. Use caption_tracks to choose one track via transcriptId when needed. If no visible captions exist, ask me to add or enable them; never fabricate speech. Return the files and editable project.' },
  { id: 'design-studio', icon: 'layout-line', title: 'HTML Design Studio (Phase 2)', description: 'Phase 2 planned capability (returns 501 FEATURE_DEFERRED_P2 in Cloud P1): responsive HTML prototypes, 16:9 slide decks, print-ready documents, website clones, live artifacts and WebGL experiences backed by cloud persistence.', tools: ['openmotion_design_catalog', 'openmotion_design_project', 'openmotion_design_edit'], prompt: designBriefPrompt({ scenario: 'prototype', brief: 'Design a responsive SaaS landing page with clear hero, feature comparison and pricing.' }) },
  { id: 'design-annotations', icon: 'chat-1-line', title: 'Revise HTML designs from annotations (Phase 2)', description: 'Phase 2 planned capability (returns 501 FEATURE_DEFERRED_P2 in Cloud P1): pin element comments, mark regions or draw pen notes directly on the HTML preview, then hand off scoped revisions to your Agent.', tools: ['openmotion_design_comments'], prompt: 'List open annotations on my Design Studio project with openmotion_design_comments action=list, apply only the requested changes, and mark each addressed annotation resolved with openmotion_design_comments action=update.' },
] as const;

export const searchRecoveryExample = (t: (message: string) => string) => templateSearchBrief({ mode: 'reference', source: 'link', query: '', reference: t('Your reference video link'), description: '' }, t);

const exploreTemplateWorkflow = 'Open a template in Explore to inspect its project or recreation guide. Try as a video prompt copies its description into Cinema Studio. Edit the draft, choose an available model and generate when ready.';

/** Scenarios compose existing tools; keep atomic tool discovery unique above. */
export const animeOpeningScenario = {
  id: 'anime-opening', icon: 'clapperboard-line', title: 'From a keyframe to an anime opening',
  description: 'Plan the shots in your Agent. Create a keyframe and animate the approved frame through the unified OpenDesign Model Gateway.',
  tools: ['openmotion_media_use', 'openmotion_assets_use', 'openmotion_create_project', 'openmotion_open_preview'],
  prompt: 'Plan an anime opening over a floating city at sunset. Inspect available image and first-frame video models on the OpenDesign Model Gateway with openmotion_media_use. Generate a keyframe and let me choose the saved version. Animate that version, track each original job with openmotion_assets_use, then assemble the clip in a new editable project with openmotion_create_project and open its preview with openmotion_open_preview.',
};

export const mcpScenarios = [animeOpeningScenario, {
  id: 'search-recovery', icon: 'search-line', title: 'Create without a matching template',
  description: 'In Template library, add a public video link, upload a reference clip, or describe what you want. Copy the request and send it in your connected Agent. Uploaded references are stored in your workspace Assets.',
  tools: ['openmotion_create_project', 'openmotion_edit_project', 'openmotion_open_preview'],
  prompt: searchRecoveryExample(message => message),
}, {
  id: 'template-guide', icon: 'layout-grid-line', title: 'Continue a guide example',
  description: 'Open a template’s motion guide and try its declared text and accent controls, then copy the requirements or enter the editor. Keep the exact template and draft. This creates the authored example, not the reference film; only confirmed unapplied failures permit a new creation request.',
  tools: ['openmotion_get_template', 'openmotion_create_project', 'openmotion_open_preview'],
  prompt: templateGuideContinuationInstruction,
}, {
  id: 'review-comments', icon: 'chat-1-line', title: 'Review a video with comments',
  description: 'Choose Comment here or Draw a comment in the playback controls, then click or draw on the frame. A small floating card opens for your feedback without resizing the video. Save notes, then copy pending comments from Review list to an Agent connected to this workspace. Time, element context and marks travel with the feedback. The Agent checks current revisions, edits and verifies before resolving comments. If a target changed, review its saved context. Copying does not start an Agent; comments stay local.',
  tools: ['openmotion_manage_project', 'openmotion_get_project', 'openmotion_edit_project', 'openmotion_open_preview'],
  prompt: reviewCommentsPrompt(),
}, {
  id: 'asset-naming', icon: 'folder-open-line', title: 'Name project assets',
  description: 'Start with a saved project. Preserve readable names; name missing or new assets in the project’s naming language. Names change without moving files. If a save conflicts, reread the project before retrying.',
  tools: ['openmotion_get_project', 'openmotion_edit_project'],
  prompt: assetNamingInstruction,
}, {
  id: 'template-to-video-prompt', icon: 'movie-line', title: 'Try as a video prompt',
  description: exploreTemplateWorkflow,
  tools: ['openmotion_get_template', 'openmotion_media_use', 'openmotion_assets_use'],
  prompt: 'Read my selected template with openmotion_get_template and adapt its description into a video prompt. Find a compatible model with openmotion_media_use. Show me the draft and model before generating with openmotion_assets_use.',
}, {
  id: 'studio-shot', icon: 'film-line', title: 'Create a shot from this brief',
  description: 'Generate a clip in Shorts, Marketing or Explainer Studio. Marketing also offers product images. Start from your idea or a Skill brief and choose a model from the OpenDesign Model Gateway.',
  tools: ['openmotion_media_use', 'openmotion_assets_use'],
  prompt: 'Generate one clip for the brief below. Find a compatible model with openmotion_media_use. Confirm the model and any first-frame image version, then submit once with openmotion_assets_use and track the original job.',
}, {
  id: 'shot-to-video', icon: 'film-line', title: 'Use as first frame',
  description: 'In Cinema Studio, open a shot still, select a version and use it as the first frame. Choose a video model with image input.',
  tools: ['openmotion_media_use', 'openmotion_assets_use'],
  prompt: 'Use openmotion_assets_use to find my shot still and confirm the version. Use openmotion_media_use to discover a video model with first-frame input on the OpenDesign Model Gateway. Use the confirmed image version as the reference in openmotion_assets_use and track the video job.',
}, {
  id: 'spatial-scene', icon: 'box-3-line', title: '3D showcase',
  description: '3D Studio is coming soon and does not support direct generation. Choose one of its six 3D creative Skills, fill in a brief and copy it to a connected Agent to create an editable scene in OpenMotion.',
  tools: ['openmotion_assets_use', 'openmotion_create_project', 'openmotion_edit_project'],
  prompt: 'Use openmotion_create_project for the new scene and openmotion_edit_project for revision-checked edits. If the brief names a reference, read its pinned version with openmotion_assets_use.',
}, {
  id: 'credited-template', icon: 'layout-grid-line', title: 'Adapt a credited template',
  description: 'Open Creators in Explore, choose a catalogue credit or source account, then open a work. Copy its template instruction to use it with your Agent.',
  tools: ['openmotion_get_template'],
  prompt: 'Use openmotion_get_template with the template ID in my brief. Inspect its editable source or recreation guide and keep its credit when adapting it.',
}, ...creativeStudios.filter(studio => studio.surface === 'techniques' && studio.id !== '3d').map(studio => ({
  id: studio.id, icon: studio.icon, title: studio.title, description: studio.briefHint,
  tools: ['openmotion_get_skill', 'openmotion_create_project', 'openmotion_edit_project'],
  prompt: 'Read the selected Skill with openmotion_get_skill. Confirm the source footage or brief, then use openmotion_create_project and openmotion_edit_project to produce an editable result. If an input is missing, ask for it before editing.',
})), {
  id: 'platform-export', icon: 'sparkling-line', title: 'Prepare a platform version',
  description: 'In Export → Platform export, choose a platform and goal. Defaults preserve the full video and captions; expand Customize version for language, canvas and duration. Copy the brief to your Agent to create editable versions and export MP4.',
  tools: ['openmotion_get_project', 'openmotion_manage_project', 'openmotion_edit_project', 'openmotion_open_preview', 'openmotion_export_request'],
  prompt: 'Prepare a platform version',
}, {
  id: 'design-create', icon: 'layout-line', title: 'Create an HTML prototype or slide deck (Phase 2)',
  description: 'Scheduled for Phase 2 (501 FEATURE_DEFERRED_P2 in Cloud P1): pick a scenario, starter template and design system in Design Studio, then copy the MCP brief to your Agent.',
  tools: ['openmotion_design_catalog', 'openmotion_design_project', 'openmotion_design_edit'],
  prompt: designBriefPrompt({ scenario: 'deck', brief: 'Design a 10-slide product launch deck with speaker notes and clear metrics.' }),
}, {
  id: 'design-iterate', icon: 'chat-1-line', title: 'Iterate a design from element annotations (Phase 2)',
  description: 'Scheduled for Phase 2 (501 FEATURE_DEFERRED_P2 in Cloud P1): mark elements, regions or pen strokes on Desktop, Tablet or Mobile preview, then hand off open annotations to your Agent.',
  tools: ['openmotion_design_comments', 'openmotion_design_edit', 'openmotion_design_project'],
  prompt: 'List open annotations with openmotion_design_comments action=list, read affected HTML files with openmotion_design_edit action=read_file, write scoped revisions with openmotion_design_edit action=write (passing expectedRevision), mark addressed annotations resolved with openmotion_design_comments action=update, and open the updated preview with openmotion_design_project action=open.',
}, {
  id: 'design-interop', icon: 'folder-open-line', title: 'Import from and export to Open Design (Phase 2)',
  description: 'Scheduled for Phase 2 (501 FEATURE_DEFERRED_P2 in Cloud P1): import an Open Design ZIP into Design Studio, iterate with your Agent, and export a compatible round-trip archive.',
  tools: ['openmotion_design_project', 'openmotion_design_edit'],
  prompt: 'Import my Open Design ZIP using openmotion_design_project action=import, inspect or update its files with openmotion_design_edit action=write, and export a round-trip archive with openmotion_design_project action=export format=open-design.',
}, {
  id: 'design-export', icon: 'slideshow-line', title: 'Export a slide deck as PDF or PPTX (Phase 2)',
  description: 'Scheduled for Phase 2 (501 FEATURE_DEFERRED_P2 in Cloud P1): render a Design Studio slide deck at 1920×1080 into PDF or PowerPoint (.pptx) with speaker notes.',
  tools: ['openmotion_design_project'],
  prompt: 'Inspect my Design Studio deck with openmotion_design_project action=get and export it with openmotion_design_project action=export format=pptx (or format=pdf). Return the saved output path.',
}] as const;

export const platformExportExample = (locale: string, workspace?: Pick<IntegrationInfo, 'previewUrl' | 'dataDirectory'>) => platformExportPrompt({ target: defaultPlatformExportTarget(locale), goal: 'adapt', locale, workspace });

export const mcpReviewGuide = [
  ['Read original data', 'Copied notes include IDs, text, time, element context, source revisions and complete drawing vectors. The Agent reads current records and full HTML/CSS/JS through MCP; drawings are not screenshots.'],
  ['Process comments', 'Edit and verify the video, then mark addressed comments complete. Agents can also update comment text, reopen or delete specific comments when requested. Copying alone performs no action.'],
  ['Recover safely', 'Connect to the same workspace. Re-read changed comments and source files before retrying. If an element disappeared or verification is unavailable, keep the comment open and explain the blocker.'],
] as const;

export const mcpBenefits = [
  { icon: 'movie-line', title: 'The workspace behind your Agent', description: 'Your Agent creates and edits over Streamable HTTP MCP. OpenMotion keeps the project, source files and S3 assets together so each result can become the next starting point.' },
  { icon: 'history-line', title: 'Versions you can return to', description: 'Keep saved versions, revisit an earlier cut and continue from it without losing the later history.' },
  { icon: 'folder-open-line', title: 'Assets that stay with the project', description: 'Keep uploaded footage and generated images, clips, music and voice in cloud content-addressed storage, ready for the next edit.' },
  { icon: 'refresh-line', title: 'Continue with another Agent', description: 'Connect any OAuth 2.1 or PAT-authenticated Agent to the same workspace /mcp endpoint and pick up where you left off.' },
  { icon: 'layout-grid-line', title: 'Templates you can build on', description: 'Studio and MCP share the template catalogue. Adapt an editable project or turn a reference into your own version.' },
] as const;

export const mcpFaq = [
  ['How do I find where project audio is used?', 'In My assets, audio rows show usage status and clickable application intervals. Click a range to select the clip and seek to its start; nested audio opens its owning composition first. Used audio omits duplicate file duration, and narrow panels keep usage on its own line. Detailed previews retain audition and visualization.'],
  ['Can I generate from a reference image?', "Yes. Supported image models on the OpenDesign Model Gateway can edit a reference, and video models with first-frame support can animate a pinned image version from Assets. Prepare the reference first for a fixed frame."],
  ['Which audio can I generate?', 'Speech, music and sound effects depend on the models available on the OpenDesign Model Gateway. BGM uses a music model. Use openmotion_media_use to inspect discovered modes and native parameters.'],
  ['How is a Brand Kit different from a Template?', 'Brand Kits package visual identity (colors, typography, logos and design rules) separately from template story choreography. Automated website Brand Kit capture is scheduled for Phase 2 (501 FEATURE_DEFERRED_P2 in Cloud P1), while official catalog entries remain browsable.'],
  ['Can Studio run inside DeepSeek Harness?', 'Yes. Point DeepSeek Harness to the Streamable HTTP /mcp endpoint in openmotion-dsh.yaml with your OPENMOTION_TOKEN Bearer token—no local stdio subprocess or docker exec wrapper is needed.'],
  ['Can I continue with another Agent?', 'Yes. Connect another compatible Agent to the same Streamable HTTP /mcp endpoint using OAuth 2.1 or a workspace Personal Access Token, and ask it to read the saved project before editing.'],
  ['Which Agents are supported?', 'Any client supporting Streamable HTTP MCP works, including Codex, Claude Code, Cursor, DeepSeek Harness, Claude Desktop, and ChatGPT Cloud (when deployed behind public HTTPS with OAuth 2.1).'],
  ['How do I reuse a community example?', exploreTemplateWorkflow],
  ['How can my Agent find short-form videos?', 'Call openmotion_list_templates and filter its index for shortForm=true. Open a matching work with openmotion_get_template. The Short-form video collection in Explore shows matching works with covers.'],
  ['How do I start with a scene or an editing preset?', 'Open Explore to choose a scene, preview an editable template or open an editing Skill. The Video menu also links to storyboards, scripted cuts and vertical shorts. Open a Skill, set its options and copy its instruction into your connected Agent.'],
  ['How do I start from a template?', 'Preview a template and send its prompt to your connected Agent. Ready-to-edit templates can be adapted or exported unchanged as an HTML project and MP4, with the exported file checked. Reference-only entries need reconstruction.'],
  ['Can I generate images, video, music and voice in one project?', 'Yes. All media generation routes through the unified OpenDesign Model Gateway (or deterministic local fixtures when MODEL_GATEWAY_MODE=mock). Results persist in S3 content-addressed storage and can be imported zero-copy into any project.'],
  ['How long does a video take?', 'It depends on the film, the Agent, the selected models and render worker capacity. Media generation and MP4 rendering run as separate background BullMQ jobs; keep polling the original jobId instead of submitting duplicates.'],
  ['Will my Agent use another video platform?', 'Your Agent chooses material sources to fit the content: real events call for original material; original visuals may use generation. It prefers OpenMotion when its available capabilities fit the operation, and can use other tools, including video platforms, to fill capability gaps. Your existing permissions and source preferences still apply.'],
  ['Can a team work on the same project?', 'Yes. Cloud workspaces support role-based access (owner, admin, editor, viewer) with optimistic revision locks, plus ZIP export/import via openmotion_project_archive for offline sharing.'],
  ['Does platform export publish my video?', 'No. Your Agent creates editable platform and subtitle-language copies, previews them and exports verified MP4 files on render workers. You upload the finished files yourself.'],
  ['Who makes OpenMotion?', 'OpenMotion is an independent open-source project. The supported Agent and model names identify integrations, not ownership or endorsement. Visit the repository for the source, licenses and contribution guide.'],
  ['Do I need an OpenMotion API key or third-party BYOK keys?', 'No BYOK third-party provider keys are needed—all model execution routes through the unified OpenDesign Model Gateway. For external MCP clients that do not use OAuth 2.1, create a workspace Personal Access Token (PAT) under Settings > Account.'],
  ['Which models can I use?', 'Available image, video and audio models come from the unified OpenDesign Model Gateway (or built-in mock fixtures when MODEL_GATEWAY_MODE=mock). Studio and MCP share the same live catalog and workspace defaults.'],
  ['How do I import my own files into a cloud project?', 'Use openmotion_import_assets in one of three cloud modes: prepare_upload + upload_ticket (presigned S3 PUT), a public SSRF-checked HTTPS url, or a zero-copy library_asset reference. Local host filesystem paths are not accessible to cloud containers.'],
  ['How do I restore an asset version?', 'Open the asset, select a version in the right inspector and choose Make current version. Later versions remain available. Studio and MCP use the same asset update operation; references and downloads keep their exact version identity.'],
  ['Can ChatGPT Cloud connect to this workspace?', 'Yes when OpenMotion is deployed on a public HTTPS domain with OAuth 2.1 enabled (https://<domain>/mcp). Local HTTP Docker Compose setups (http://127.0.0.1:4173/mcp) work with Codex, Claude Code, Cursor and DeepSeek Harness instead.'],
  ['Can I recreate a reference video?', 'Yes. Give your Agent the reference and your brand. The recreation Skill analyses the reference, rebuilds the film as editable source, checks representative preview moments and hands it over after automatic technical export verification on render workers.'],
  ['Where do I find my finished work?', 'Projects, snapshots, assets and rendered MP4 exports are stored in your workspace Postgres database and S3 content-addressed object storage. Open the project in Studio or download completed exports via presigned URLs.'],
  ['Can I see templates and videos inside my Agent?', 'Clients that negotiate MCP Apps can discover optional template cards and the final-video player. Other clients use Studio links and completed export URLs; host support varies.'],
  ['What if the final video cannot load?', 'Prefer the host’s video preview; Codex normally shows it in the final reply. Use the OpenMotion player only if native preview is unavailable, never both for the same video. If the OpenMotion player cannot load, choose Reload to read the same completed export without rendering again.'],
  ['How do I disconnect an Agent?', 'Remove the OpenMotion Streamable HTTP entry in that Agent and revoke its Personal Access Token (or OAuth grant) under Settings > Account. Projects and assets remain safe in your workspace.'],
  ['Does connecting start generation or spend credits?', 'No. Copying setup instructions, browsing templates and checking a connection do not start media generation. OpenDesign Model Gateway generation requests may consume workspace credits; ask your Agent to confirm the model and scope first.'],
  ['Can I transcribe recordings and make multilingual platform videos?', 'Manual captions, SRT/VTT import, caption styling and multilingual platform export briefs are available now. Automated cloud speech recognition (ASR) job submission is scheduled for Phase 2 (501 FEATURE_DEFERRED_P2).'],
  ['How does Design Studio work in Cloud Phase 1?', 'The four openmotion_design_* tools remain registered in the public MCP contract for forward compatibility, and cloud HTML Design Studio persistence & annotations are scheduled for Phase 2 (returning 501 FEATURE_DEFERRED_P2 in Phase 1).'],
] as const;

/** Compare concrete workflows, without claiming features of unspecified competitors. */
export const mcpWorkflowComparison = [
  ['Brief, storyboard and creative direction', 'Guided production Skills', 'Build your own orchestration', 'Plan and author yourself'],
  ['Discover templates and brand references', 'Shared catalogue and exact template prompts', 'Bring your own catalogue', 'Browse the template library'],
  ['Recreate a reference or adapt a template', 'Agent-led, editable source', 'Generate media from a prompt', 'Edit the source yourself'],
  ['Generate images, video, music and voice', 'Unified OpenDesign Model Gateway', 'Per-model API and credentials', 'OpenDesign Model Gateway'],
  ['Edit timing, typography, scenes and audio', 'Agent edits and Studio controls', 'Requires an editing workflow', 'Studio editing controls'],
  ['Reuse uploaded and generated assets', 'S3 CAS workspace assets across iterations', 'Manage files and storage yourself', 'Presigned upload & library'],
  ['Version history and safe restoration', 'Version-checked edits and restore tools', 'Implement project history yourself', 'Studio version history'],
  ['Preview, render and deliver MP4', 'Studio preview and render-worker exports', 'Requires a rendering workflow', 'Preview and export in Studio'],
] as const;

export const mcpClientComparison = [
  ['Connection', 'Streamable HTTP (/mcp) · OAuth 2.1 / PAT', 'Streamable HTTP (/mcp) · OAuth 2.1 / PAT', 'Streamable HTTP (public HTTPS + OAuth 2.1)'],
  ['Creative workflow guides', 'Installed Skills and MCP resources', 'Requires resource support', 'MCP resources & prompts'],
  ['Templates and brand references', 'Shared catalogue and exact template prompts', 'Requires tools and resource support', 'Shared catalogue via MCP tools'],
  ['Editable projects and animation', 'Supported', 'Requires tools and resource support', 'Supported'],
  ['Images, video, music and voice', 'Unified OpenDesign Model Gateway', 'Unified OpenDesign Model Gateway', 'Unified OpenDesign Model Gateway'],
  ['Media import', 'Presigned upload ticket, HTTPS URL, or library asset', 'Presigned upload ticket, HTTPS URL, or library asset', 'Presigned upload ticket, HTTPS URL, or library asset'],
  ['Version history and restoration', 'Supported', 'Requires tools and resource support', 'Supported'],
  ['Preview and MP4 export', 'Cloud Studio and render-worker MP4 URLs', 'Cloud Studio and render-worker MP4 URLs', 'Cloud Studio and render-worker MP4 URLs'],
  ['Inline template cards and final video', 'Codex: native video and HTML onboarding cards; others depend on host support', 'Host-native video when available; MCP Apps otherwise', 'Studio links & download URLs'],
] as const;
