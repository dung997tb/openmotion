import { Button } from 'open-design-ui/button';
import { useMemo, useState } from 'react';
import { rankSearchResults } from '../../../../shared/fuzzy-search';
import { useI18n } from '../../i18n/I18n';
import { RemixIcon } from '../../icons/RemixIcons';
import { optionId as optionFilter } from '../reporting';
import { genreCovers, genreLabels } from './gameCatalog';
import { reportGameClick } from './gameTracking';
import { topGameCard, topGames, type TopGame } from './topGames';
import './gameStudio.css';

type Filter = 'all' | 'iap' | 'iaa' | 'web';
const filters: { id: Filter; label: string; match: (game: TopGame) => boolean }[] = [
  { id: 'all', label: 'All', match: () => true },
  { id: 'iap', label: 'In-app purchases', match: game => game.monetization !== 'IAA' },
  { id: 'iaa', label: 'Ad revenue', match: game => game.monetization === 'IAA' || game.monetization === '混合' },
  { id: 'web', label: 'Easy to build', match: game => game.webFeasible === 'high' },
];

/** Top 100 tab: the money-making mini games ranked by public revenue signal, each with 做同款 for an original game. */
export function GameTopChart({ query, selectedId, onRemix }: { query: string; selectedId?: string | null; onRemix: (game: TopGame) => Promise<void> | void }) {
  const { t, locale } = useI18n();
  const zh = locale === 'zh-CN';
  const [filter, setFilter] = useState<Filter>('all');
  const [busy, setBusy] = useState<string | null>(null);
  const list = useMemo(() => {
    const picked = topGames.filter(filters.find(item => item.id === filter)!.match);
    const needle = query.trim();
    return needle ? rankSearchResults(picked, needle, game => ({
      id: game.id, title: zh ? game.name : game.nameEn || game.name, subtitle: t(genreLabels[game.genre]), description: zh ? game.loop : game.loopEn,
      tags: [game.genre, game.platform, game.monetization], aliases: [game.name, game.nameEn, game.loop, game.loopEn],
    })).map(result => result.item) : picked;
  }, [filter, query, t, zh]);

  const remix = async (game: TopGame, position: number) => {
    if (busy) return;
    reportGameClick('game_market', 'remix_game', topGameCard(game), { position });
    setBusy(game.id);
    try { await onRemix(game); } finally { setBusy(null); }
  };

  return <section className="om-game-row om-game-top" aria-label={t('Top 100 money-making games')}>
    <header className="om-game-top-head">
      <div>
        <h2 className="om-subtitle"><RemixIcon name="fire-line" size={16} />{t('Top 100 money-making games')}</h2>
        <p className="om-muted om-game-row-note">{t('Ranked by public top-grossing charts and revenue reports. Remix builds an original game with the same core loop, never a copy of names, characters or art.')}</p>
      </div>
      <div className="om-segmented om-game-top-filters" role="tablist" aria-label={t('Revenue model')}>
        {filters.map(item => <Button key={item.id} variant="plain" role="tab" className="om-nav-item" aria-selected={filter === item.id}
          onClick={() => { if (filter !== item.id) reportGameClick('game_market', 'category_select', null, optionFilter('top100-' + item.id)); setFilter(item.id); }}>{t(item.label)}</Button>)}
      </div>
    </header>
    {list.length ? <ol className="om-game-top-list">
      {list.map((game, index) => <li key={game.id} className="om-game-top-item" data-rank={game.rank <= 3 ? game.rank : undefined} data-selected={selectedId === topGameCard(game).id || undefined}>
        <span className="om-game-top-rank">{game.rank}</span>
        <span className="om-game-top-art">{genreCovers[game.genre] && <img src={genreCovers[game.genre]!} alt="" loading="lazy" />}</span>
        <div className="om-game-top-body">
          <strong>{zh ? game.name : game.nameEn || game.name}</strong>
          <span className="om-game-top-tags">
            <span>{game.platform}</span><span>{game.monetization === 'IAA' ? t('Ad revenue') : game.monetization === 'IAP' ? t('In-app purchases') : t('Hybrid')}</span>
            <span>{t(genreLabels[game.genre])}</span><span>{t(game.orientation === 'portrait' ? 'Portrait' : 'Landscape')}</span>
            {game.webFeasible === 'high' && <span data-tone="good">{t('Easy to build')}</span>}
          </span>
          <p>{zh ? game.loop : game.loopEn || game.loop}</p>
          <a className="om-muted om-game-top-signal" href={game.sourceUrl} target="_blank" rel="noopener noreferrer">
            <RemixIcon name="external-link-line" size={13} />{zh ? game.signal : game.signalEn || game.signal}</a>
        </div>
        <Button variant="ghost" className="om-button h-auto om-game-top-remix" data-primary aria-pressed={selectedId === undefined ? undefined : selectedId === topGameCard(game).id}
          disabled={Boolean(busy)} onClick={() => void remix(game, index)}>
          <RemixIcon name={busy === game.id ? 'loader-4-line' : selectedId === topGameCard(game).id ? 'check-line' : 'add-line'} size={16} />{selectedId === topGameCard(game).id ? t('Selected') : t('Remix')}</Button>
      </li>)}
    </ol> : <div className="om-discovery-empty"><span>{t('No games match these filters.')}</span></div>}
  </section>;
}
