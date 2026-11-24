import geminiPoster from './model-hubs/gemini-4.svg?url';
import { gemini4Videos, type HubVideo } from './gemini4Videos';
import { findMediaStudio } from '../../../shared/studio-catalog';
import { studioDestination, type StudioDestination } from './creativeStudios';
import cover04 from './corridor-covers/cover-04.jpg';
import cover06 from './corridor-covers/cover-06.webp';
import cover08 from './corridor-covers/cover-08.jpg';
import cover10 from './corridor-covers/cover-10.jpg';
import cover11 from './corridor-covers/cover-11.webp';
import cover12 from './corridor-covers/cover-12.jpg';
import cover14 from './corridor-covers/cover-14.jpg';
import cover15 from './corridor-covers/cover-15.webp';
import cover17 from './corridor-covers/cover-17.jpg';
import cover18 from './corridor-covers/cover-18.jpg';
import cover20 from './corridor-covers/cover-20.jpg';
import cover22 from './corridor-covers/cover-22.webp';
import cover23 from './corridor-covers/cover-23.webp';
import cover24 from './corridor-covers/cover-24.webp';
import cover25 from './corridor-covers/cover-25.webp';
import cover26 from './corridor-covers/cover-26.webp';
import cover27 from './corridor-covers/cover-27.webp';
import cover28 from './corridor-covers/cover-28.webp';
import cover29 from './corridor-covers/cover-29.webp';
import cover30 from './corridor-covers/cover-30.webp';
import cover35 from './corridor-covers/cover-35.webp';
import glassSculpture from './scene-art/studio-glass-sculpture.jpg';
import retroPoster from './model-hubs/gpt-image-2-6/retro-print-poster.webp';
import lightShadowProduct from './model-hubs/gpt-image-2-6/light-shadow-product.webp';
import surreal3dPoster from './model-hubs/gpt-image-2-6/surreal-3d-poster.webp';

/** Local posters for posts whose X cover is a blank first frame; captured mid-video. */
const posterOverrides: Record<string, string> = Object.fromEntries(Object.entries(import.meta.glob('./model-hubs/gemini-4/posters/*.jpg', { query: '?url', import: 'default', eager: true }) as Record<string, string>)
  .map(([path, url]) => [path.split('/').pop()!.replace(/\.jpg$/, ''), url]));
const withPoster = (video: HubVideo): HubVideo => posterOverrides[video.id] ? { ...video, poster: posterOverrides[video.id] } : video;

export interface HubShowcaseCase {
  id: string;
  title: string;
  titleZh: string;
  tag: string;
  tagZh: string;
  poster: string;
  /** Natural width/height ratio used for staggered masonry layout (e.g. 9/16, 4/3, 16/9, 1). */
  aspectRatio: number;
  prompt: string;
  promptZh: string;
  destination: StudioDestination;
}

/**
 * Model hubs are editorial landing pages for a model family. Facts come from the
 * vendor's own announcement; availability is always read from the live gateway
 * catalog, so a hub never claims a model is usable before a provider serves it.
 */
export interface ModelHub {
  id: string;
  title: string;
  /** Full name of the model people can use today, shown wherever access is explained. */
  modelName: string;
  /** Full name of the newest release, shown on the Explore banner. */
  latestModel: string;
  vendor: string;
  eyebrow: string;
  eyebrowZh?: string;
  summary: string;
  summaryZh?: string;
  poster: string;
  /** Matches gateway model ids or model ids served for this family. */
  modelPattern: RegExp;
  /** Matches companion media models from the same vendor already in the catalog. */
  companionPattern: RegExp;
  provider: string;
  /** Optional primary Studio destination when launching directly from the hub hero. */
  primaryDestination?: StudioDestination;
  primaryCta?: string;
  primaryCtaZh?: string;
  /** Optional Black Friday promo note / bundled models highlighted in the hero. */
  promoModels?: string[];
  promoBadge?: string;
  promoBadgeZh?: string;
  /** Curated 1-click remixable showcase cases for this model hub. */
  cases?: HubShowcaseCase[];
  casesHeading?: string;
  casesHeadingZh?: string;
  /** Community videos made with this family; media stays on the original posts. */
  videos: HubVideo[];
}

const cinema = findMediaStudio('cinema')!;
const design = findMediaStudio('design')!;
const cinemaTextToVideo = studioDestination(cinema, 'text-to-video');
const cinemaImageToVideo = studioDestination(cinema, 'image-to-video');
const designTextToImage = studioDestination(design, 'text-to-image');

export const modelHubs: ModelHub[] = [
  {
    id: 'seedance-2-5',
    title: 'Seedance 2.5',
    modelName: 'Seedance 2.5',
    latestModel: 'Seedance 2.5',
    vendor: 'ByteDance',
    eyebrow: 'Black Friday 50% Off',
    eyebrowZh: '黑五首年 5 折',
    summary: 'Multi-shot cinema video generation · Unlock with Go Plus or above.',
    summaryZh: '电影级多镜头视频生成 · 开通 Go Plus 及以上解锁，24 套案例一键同款',
    poster: cover26,
    provider: 'opendesign',
    modelPattern: /seedance[\s._/-]*v?2[.\s_-]5(?!\d|\.\d)/i,
    companionPattern: /seedream|kling|veo|wan/i,
    primaryDestination: cinemaTextToVideo,
    primaryCta: 'Start Creating',
    primaryCtaZh: '前往创作',
    promoBadge: '50% Off Annual',
    promoBadgeZh: '黑五 5 折',
    casesHeading: '1-Click Cinema Templates',
    casesHeadingZh: '精选同款大片',
    cases: [
      {
        id: 'sd-pink-horizon',
        title: 'Pastel Horizon Walk',
        titleZh: '粉雾旷野 · 广角仰拍',
        tag: 'Fashion & Visual',
        tagZh: '时尚视觉',
        poster: cover25,
        aspectRatio: 9 / 16,
        prompt: 'Ultra-wide low-angle fashion film of a model in tailored ivory flared trousers framed against a soft rose-pink dusk sky over dark asphalt, gentle camera push-in, dreamy halation glow.',
        promptZh: '超广角低机位时装短片：身着象牙白阔腿裤的模特伫立在深色柏油路与柔和粉雾黄昏天际之间，镜头缓慢推进，带柔和胶片光晕。',
        destination: cinemaTextToVideo,
      },
      {
        id: 'sd-cloud-giant',
        title: 'Runway Giant Track',
        titleZh: '云绒高定 · 超现实赛道',
        tag: 'Fashion & Visual',
        tagZh: '时尚视觉',
        poster: cover26,
        aspectRatio: 4 / 3,
        prompt: 'Low-angle cinema dolly shot looking up at a model in an oversized powder-blue sculptural feather coat standing over a miniature red sports car racing on a curved track, misty cyan cyclorama studio lighting, 35mm anamorphic lens.',
        promptZh: '低机位电影推轨镜头仰拍：模特身着超大雾蓝色羽毛雕塑大衣屹立于赛道之上，一辆红色微型跑车沿弧形弯道飞驰而过，青蓝影棚雾光，35mm 变形宽银幕质感。',
        destination: cinemaTextToVideo,
      },
      {
        id: 'sd-teardrop-closeup',
        title: 'Teardrop Cinema Close-Up',
        titleZh: '泪光微距 · 电影情绪',
        tag: 'Creative Ads',
        tagZh: '创意广告',
        poster: cover27,
        aspectRatio: 16 / 9,
        prompt: 'Intimate 85mm anamorphic close-up portrait of a curly-haired woman with a single glistening tear sliding down her cheek, warm tungsten key light, subtle breathing camera drift, raw 35mm film grain.',
        promptZh: '85mm 变形镜头极致微距情绪特写：卷发女性眼眶微红、一滴晶莹泪珠沿脸颊滑落，暖色影院主光与细腻 35mm 胶片颗粒。',
        destination: cinemaTextToVideo,
      },
      {
        id: 'sd-camp-heroine',
        title: 'Field Tent Dialogue',
        titleZh: '营地长镜头 · 电影叙事',
        tag: 'Creative Ads',
        tagZh: '创意广告',
        poster: cover28,
        aspectRatio: 16 / 9,
        prompt: 'Cinematic tracking medium shot inside a sunlit canvas field tent, determined woman wearing a red patterned neckerchief speaking with raw emotion, dusty golden backlighting, shallow depth of field.',
        promptZh: '战地帆布帐篷内的电影中景跟拍：颈系红色丝巾的女性神情坚毅而克制，金色逆光穿透微尘，浅景深电影叙事质感。',
        destination: cinemaTextToVideo,
      },
      {
        id: 'sd-shibuya-walk',
        title: 'Tokyo Crossing Street',
        titleZh: '东京街头 · 胶片跟拍',
        tag: 'Fashion & Visual',
        tagZh: '时尚视觉',
        poster: cover30,
        aspectRatio: 16 / 9,
        prompt: '35mm street documentary tracking shot of a stylish youth holding a soft-serve cone walking through a bustling Tokyo crosswalk at dusk, neon signs softening into creamy bokeh.',
        promptZh: '35mm 街头纪实跟拍：潮流青年手持冰淇淋漫步黄昏东京十字路口，霓虹招牌与人群在身后柔和虚化成奶油散景。',
        destination: cinemaTextToVideo,
      },
      {
        id: 'sd-sushi-bar',
        title: 'Omakase Counter Wide',
        titleZh: '绿光日料 · 广角镜头',
        tag: 'Creative Ads',
        tagZh: '创意广告',
        poster: cover23,
        aspectRatio: 16 / 9,
        prompt: 'Stylized wide-angle cinema shot at a serene Kyoto sushi counter: model in sheer emerald mesh top lifting nigiri with wooden chopsticks while the chef works softly in the warm background.',
        promptZh: '风格化广角电影镜头：身着翡翠绿薄纱上衣的模特在静谧京都寿司板前夹起握寿司，背景暖光映出主厨柔和虚化身影。',
        destination: cinemaTextToVideo,
      },
      {
        id: 'sd-night-drive',
        title: 'Midnight Car Interior',
        titleZh: '深夜驾驶 · 情绪特写',
        tag: 'Motion & Speed',
        tagZh: '速度运镜',
        poster: cover24,
        aspectRatio: 16 / 9,
        prompt: 'Intimate cinematic medium shot inside a car driving through quiet city streets at night, woman in camel wool coat illuminated by passing cool-cyan and amber streetlights, contemplative cinema pacing.',
        promptZh: '车内近景电影叙事镜头：身着驼色大衣的女性深夜驾车穿行城市街道，车窗外冷青与暖琥珀路灯光影掠过脸庞，细腻情绪氛围。',
        destination: cinemaImageToVideo,
      },
      {
        id: 'sd-cherry-soda',
        title: 'Retro Cherry Sip',
        titleZh: '复古樱桃饮 · 对称构图',
        tag: 'Creative Ads',
        tagZh: '创意广告',
        poster: cover22,
        aspectRatio: 16 / 9,
        prompt: 'Symmetrical Wes Anderson style commercial shot of a chic bob-hair model sipping from a pastel pink cherry juice carton inside a glossy crimson-panelled retro diner booth, warm tungsten key lights.',
        promptZh: '对称式复古商业广告镜头：齐刘海短发模特在深红漆面复古卡座中轻啜粉红樱桃果汁盒，暖色钨丝壁灯柔光勾勒质感。',
        destination: cinemaTextToVideo,
      },
      {
        id: 'sd-crimson-f1',
        title: 'Crimson Silhouette F1',
        titleZh: '红光剪影 · 极速 F1',
        tag: 'Motion & Speed',
        tagZh: '速度运镜',
        poster: cover10,
        aspectRatio: 16 / 9,
        prompt: 'Side-tracking high-speed shot of a Formula 1 race car silhouette blazing across a molten vermilion-red studio horizon, dramatic light streaks reflecting off wet tarmac, shallow depth of field, commercial film grain.',
        promptZh: '侧面高速跟拍一台 F1 赛车剪影疾驰在炽烈朱红光带地平线上，湿润赛道映出流动光轨，浅景深与胶片颗粒，商业汽车广告级运镜。',
        destination: cinemaTextToVideo,
      },
      {
        id: 'sd-subway-commute',
        title: 'Metro Morning Stillness',
        titleZh: '地铁晨光 · 人群定格',
        tag: 'Fashion & Visual',
        tagZh: '时尚视觉',
        poster: cover29,
        aspectRatio: 16 / 9,
        prompt: 'Poetic slow-motion subway car shot: ginger-haired woman in narrow oval glasses holding a paper coffee cup stands still in the center as commuters gently sway in cool fluorescent train light.',
        promptZh: '诗意慢动作地铁车厢镜头：佩戴窄框眼镜的红发女孩手持纸杯咖啡静立中央，冷白荧光灯下通勤人群随车厢微微晃动。',
        destination: cinemaTextToVideo,
      },
      {
        id: 'sd-ny-coffee',
        title: 'Soho Corner Breakfast',
        titleZh: '纽约街角 · 胶片抓拍',
        tag: 'Fashion & Visual',
        tagZh: '时尚视觉',
        poster: cover35,
        aspectRatio: 3 / 4,
        prompt: 'Candid 35mm vertical film clip of a stylish young woman in tortoiseshell glasses and knitted arm warmers enjoying a morning bagel at a quiet Soho sidewalk cafe, foreground coffee cup bokeh.',
        promptZh: '35mm 竖屏胶片生活抓拍：戴玳瑁眼镜与针织袖套的女孩在纽约 Soho 街角咖啡馆享用早餐，前景纸杯柔和虚化。',
        destination: cinemaTextToVideo,
      },
      {
        id: 'sd-stadium-purple',
        title: 'Arena Lightstick Drone',
        titleZh: '紫海万人 · 穹顶航拍',
        tag: 'Motion & Speed',
        tagZh: '速度运镜',
        poster: cover11,
        aspectRatio: 9 / 16,
        prompt: 'Sweeping vertical FPV cinema drone gliding beneath the twilight stadium roof over an ocean of glowing violet concert lightsticks pulsing toward a luminous live stage.',
        promptZh: '竖屏 FPV 电影穿越机航拍：暮色体育场穹顶之下掠过万千紫色荧光海，镜头俯冲推向璀璨主舞台。',
        destination: cinemaTextToVideo,
      },
      {
        id: 'sd-jetpack-cat',
        title: 'Jetpack Cat Overpass',
        titleZh: '喷气白猫 · 城市高架飞跃',
        tag: 'Creative Ads',
        tagZh: '创意广告',
        poster: cover17,
        aspectRatio: 16 / 9,
        prompt: 'Dynamic handheld tracking shot following a chubby white cat wearing a sleek red mini jetpack soaring mid-air above a sunlit metropolitan highway overpass, motion blur cityscape background, blockbuster VFX realism.',
        promptZh: '动感手持跟拍一只背着红色迷你喷气背包的圆润白猫，在阳光明媚的都市高架桥上空凌空飞跃，背景高楼带速度动态模糊，电影级实拍视效。',
        destination: cinemaTextToVideo,
      },
      {
        id: 'sd-night-drift',
        title: 'Midnight Smoke Drift',
        titleZh: '午夜漂移 · 烟雾环绕',
        tag: 'Motion & Speed',
        tagZh: '速度运镜',
        poster: cover18,
        aspectRatio: 16 / 9,
        prompt: 'Cinematic music video shot at night: performer in a matte black hoodie stands calm at center while a black coupe drifts in a tight circle behind them, warm headlights cutting through billowing tire smoke.',
        promptZh: '夜间电影感 MV 镜头：身着纯黑卫衣的主角冷静凝视镜头正中，身后一台黑色跑车高速绕圈漂移，暖色车灯穿透翻涌白烟。',
        destination: cinemaTextToVideo,
      },
      {
        id: 'sd-wasabi-omakase',
        title: 'Hinoki Counter Still Life',
        titleZh: '匠心板前 · 极简微距',
        tag: 'Creative Ads',
        tagZh: '创意广告',
        poster: cover06,
        aspectRatio: 1,
        prompt: 'Quiet square-frame culinary cinema shot of fresh mountain wasabi root resting beside a hand-forged yanagiba knife on warm hinoki cypress wood, subtle steam and razor-sharp blade glint.',
        promptZh: '静谧方画幅美食电影镜头：新鲜山葵静置于温润桧木板前，手工柳刃刺身刀泛起冷冽微光，极简东方美学构图。',
        destination: cinemaTextToVideo,
      },
      {
        id: 'sd-street-drift',
        title: 'Wet Asphalt Night Drift',
        titleZh: '雨夜弯道 · 低角追焦',
        tag: 'Motion & Speed',
        tagZh: '速度运镜',
        poster: cover15,
        aspectRatio: 16 / 9,
        prompt: 'Ultra-low bumper-mounted camera tracking a white race car drifting across wet midnight asphalt, crisp reflections of city streetlamps streaking across the ground, raw cinema motion blur.',
        promptZh: '贴地低机位追拍白色赛车在雨夜湿滑路面横甩漂移，城市路灯在水面拉出锐利光带，充满速度张力的电影动态模糊。',
        destination: cinemaTextToVideo,
      },
    ],
    videos: [],
  },
  {
    id: 'gpt-image-2-6',
    title: 'GPT Image 2.6',
    modelName: 'GPT Image 2.6',
    latestModel: 'GPT Image 2.6',
    vendor: 'OpenAI',
    eyebrow: 'Black Friday Unlimited',
    eyebrowZh: '黑五限时无限用',
    summary: 'Annual Pro & Max 7-day unlimited · Includes Seedream 5.5 / 5.0 & Nano Banana 2 (API supported).',
    summaryZh: '年度 Pro / Max 7 天无限畅用 · 同步覆盖 Seedream 5.5 / 5.0 / Nano Banana 2，支持 API 调用',
    poster: glassSculpture,
    provider: 'opendesign',
    modelPattern: /gpt[\s._/-]*image[\s._/-]*v?2[.\s_-]6(?!\d|\.\d)|gpt[\s._/-]*image/i,
    companionPattern: /seedream|nano-banana|flux|imagen/i,
    primaryDestination: designTextToImage,
    primaryCta: 'Start Creating',
    primaryCtaZh: '前往生图',
    promoModels: ['GPT Image 2.6', 'Seedream 5.5', 'Seedream 5.0', 'Nano Banana 2'],
    promoBadge: '7 Days Unlimited',
    promoBadgeZh: '7 天无限畅用',
    casesHeading: 'Featured Image Recipes',
    casesHeadingZh: '旗舰生图样张',
    cases: [
      {
        id: 'gi-street-portrait',
        title: 'Soho Film Editorial',
        titleZh: '纽约街头 · 胶片人像',
        tag: 'Fashion & Portrait',
        tagZh: '时尚人像',
        poster: cover35,
        aspectRatio: 3 / 4,
        prompt: 'Candid 35mm editorial street portrait of a young woman in tortoiseshell glasses and knitted arm warmers outside a downtown cafe, natural overcast light, subtle film grain.',
        promptZh: '35mm 街头杂志感胶片人像：戴玳瑁眼镜与针织袖套的女孩在都市街角咖啡馆外自然抓拍，柔光阴天质感与胶片颗粒。',
        destination: designTextToImage,
      },
      {
        id: 'gi-glass-ribbon',
        title: 'Iridescent Glass Sculpture',
        titleZh: '虹彩流体玻璃雕塑',
        tag: 'Product & 3D',
        tagZh: '产品材质',
        poster: glassSculpture,
        aspectRatio: 4 / 3,
        prompt: 'Minimalist sculptural ribbon of blown dichroic glass floating in soft lavender-pearl studio light, delicate violet and cyan caustics, ultra-clean architectural product render, 8k octane clarity.',
        promptZh: '极简吹制虹彩玻璃流体丝带雕塑，悬浮在柔和薰衣草珍珠光影棚中，细腻蓝紫焦散折射，建筑级纯净产品渲染质感。',
        destination: designTextToImage,
      },
      {
        id: 'gi-visor-editorial',
        title: 'Chrome Visor Editorial',
        titleZh: '未来感银镜高定人像',
        tag: 'Fashion & Portrait',
        tagZh: '时尚人像',
        poster: cover04,
        aspectRatio: 16 / 9,
        prompt: 'High-fashion futuristic portrait of a platinum-blonde model in sleek metallic chrome wraparound visor sunglasses and cutout black turtleneck, windblown hair, high-key white motion-blur runway backdrop.',
        promptZh: '未来感高定时装肖像：铂金白发模特佩戴流线型液态银护目墨镜与镂空黑衫，发丝随风飘扬，高调纯白动态模糊秀场背景。',
        destination: designTextToImage,
      },
      {
        id: 'gi-stamp-portrait',
        title: 'Crimson Stamp Close-Up',
        titleZh: '红底邮票贴鼻 · 潮流肖像',
        tag: 'Fashion & Portrait',
        tagZh: '时尚人像',
        poster: cover12,
        aspectRatio: 5 / 4,
        prompt: 'Avant-garde macro fashion beauty portrait of an East Asian model with sharp jet-black bob haircut, three vintage pastel postage stamps delicately placed across the bridge of her nose, vibrant crimson studio backdrop, flash photography.',
        promptZh: '先锋时尚美妆微距肖像：利落纯黑波波头模特鼻梁处精致贴有三枚复古马卡龙邮票，高饱和正红影棚底色，直闪时尚杂志大片感。',
        destination: designTextToImage,
      },
      {
        id: 'gi-skincare-lineup',
        title: 'Minimalist Skincare Trio',
        titleZh: '极简护肤瓶 · 暖调静物',
        tag: 'Product & 3D',
        tagZh: '产品材质',
        poster: cover14,
        aspectRatio: 16 / 9,
        prompt: 'Architectural studio product lineup of minimalist clear glass and matte charcoal skincare bottles on a warm walnut tabletop, clean serif bottle typography, diffused warm cream cyclorama backlight.',
        promptZh: '极简建筑感护肤品全家福静物：透明玻璃与哑光深炭黑瓶身错落排布于胡桃木台面，克制衬线瓶身印刷，柔和暖奶油逆光棚拍。',
        destination: designTextToImage,
      },
      {
        id: 'gi-sunglass-triptych',
        title: 'Floating Portrait Triptych',
        titleZh: '悬浮画幅 · 时尚拼贴',
        tag: 'Fashion & Portrait',
        tagZh: '时尚人像',
        poster: cover20,
        aspectRatio: 3 / 2,
        prompt: 'Minimalist luxury fashion campaign composition: blonde model in dark wrap sunglasses wearing pastel pink silk top and sage parachute pants centered between two angled floating close-up portrait panels on clean white-to-grey studio gradient.',
        promptZh: '极简高定品牌视觉海报：佩戴墨镜的金发模特居中而立，两侧悬浮两块透视倾斜的人像特写画幅，纯净白灰渐变影棚背景。',
        destination: designTextToImage,
      },
      {
        id: 'gi-wasabi-minimal',
        title: 'Hinoki Culinary Still Life',
        titleZh: '东方静物 · 材质光影',
        tag: 'Product & 3D',
        tagZh: '产品材质',
        poster: cover06,
        aspectRatio: 1,
        prompt: 'Editorial minimalist food still life: fresh wasabi root and hand-forged steel blade arranged on warm hinoki wood counter, refined chiaroscuro lighting, medium-format photography.',
        promptZh: '东方极简美学商业静物：新鲜山葵与锻造钢刀陈列在温润桧木台面，克制明暗布光，中画幅摄影质感。',
        destination: designTextToImage,
      },
      {
        id: 'gi-street-billboard',
        title: 'Downtown Beverage Lightbox',
        titleZh: '街头灯箱 · 饮品户外广告',
        tag: 'Poster & KV',
        tagZh: '海报视觉',
        poster: cover08,
        aspectRatio: 16 / 9,
        prompt: 'Photorealistic street-level photograph of a sleek black backlit sidewalk advertising kiosk displaying a vivid cyan-and-yellow minimalist beverage can poster on a sunlit downtown boulevard, crisp architectural shadows.',
        promptZh: '写实街头视角：阳光洒落的城市林荫大道人行道上，黑色质感灯箱广告牌展示着青黄撞色极简饮品易拉罐海报，清晰建筑光影。',
        destination: designTextToImage,
      },
      {
        id: 'gi-light-shadow',
        title: 'Botanical Shadow Fragrance',
        titleZh: '光影静物 · 品牌包装',
        tag: 'Product & 3D',
        tagZh: '产品材质',
        poster: lightShadowProduct,
        aspectRatio: 16 / 9,
        prompt: 'Luxury amber glass dropper bottle resting on raw travertine stone plinth with crisp afternoon botanical leaf shadows cast across warm plaster wall, editorial stillness.',
        promptZh: '奢华琥珀玻璃滴管瓶静置于天然洞石基座，午后植物枝叶在暖色肌理墙面投下锐利光影，杂志级静物大片。',
        destination: designTextToImage,
      },
      {
        id: 'gi-retro-print',
        title: 'Two-Ink Risograph Poster',
        titleZh: '双色孔版 · 复古平面海报',
        tag: 'Poster & KV',
        tagZh: '海报视觉',
        poster: retroPoster,
        aspectRatio: 4 / 3,
        prompt: 'Bold two-ink risograph graphic poster on textured uncoated paper stock, tall condensed display typography paired with halftone geometric illustration, tactile print grain.',
        promptZh: '粗糙特种纸质感的双色孔版复古平面海报，高挑窄体标题排印结合半调网点几何插画，极具印刷肌理感。',
        destination: designTextToImage,
      },
      {
        id: 'gi-surreal-3d',
        title: 'Surreal 3D Art Direction',
        titleZh: '超现实 3D 概念视觉',
        tag: 'Poster & KV',
        tagZh: '海报视觉',
        poster: surreal3dPoster,
        aspectRatio: 16 / 9,
        prompt: 'Surreal minimalist 3D art direction key visual with sculptural glossy forms, dramatic studio rim light, rich atmospheric contrast, museum exhibition poster composition.',
        promptZh: '超现实极简 3D 概念主视觉：雕塑感高光几何造型搭配戏剧化轮廓棚光，强氛围明暗对比，美术馆展览级海报构图。',
        destination: designTextToImage,
      },
      {
        id: 'gi-pink-fashion-tall',
        title: 'Rose Dusk Low-Angle',
        titleZh: '粉雾天际 · 竖版视觉',
        tag: 'Poster & KV',
        tagZh: '海报视觉',
        poster: cover25,
        aspectRatio: 9 / 16,
        prompt: 'Ultra-wide vertical fashion editorial poster of tailored ivory wide-leg trousers silhouetted against a dreamy rose-pink twilight sky and dark tarmac, minimalist typography space.',
        promptZh: '超广角低机位竖版时尚海报：象牙白阔腿裤剪影伫立于暗色柏油路与粉雾暮色天际之间，极简留白构图。',
        destination: designTextToImage,
      },
    ],
    videos: [],
  },
  {
    id: 'gemini-4',
    title: 'Gemini 4',
    modelName: 'Gemini 4 Argon',
    latestModel: 'Gemini 4 Neon',
    vendor: 'Google DeepMind',
    eyebrow: 'New model',
    summary: 'Google’s newest frontier model writes whole animations in code. The hottest Gemini 4 videos on X are all here.',
    poster: geminiPoster,
    provider: 'gemini',
    modelPattern: /gemini-4/i,
    companionPattern: /google\/|nano-banana|veo|imagen/i,
    videos: gemini4Videos.map(withPoster),
  },
];

export const findModelHub = (id: string | null | undefined) => modelHubs.find(hub => hub.id === id) ?? null;
