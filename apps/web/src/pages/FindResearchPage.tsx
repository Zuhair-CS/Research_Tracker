import { useState } from 'react';
import { api } from '../api/client';
import { BookOpenIcon, InfoIcon, UsersIcon } from '../components/Icons';
import { LoadingState } from '../components/LoadingState';
import { AuthorWorks } from '../components/discover/AuthorWorks';
import { PeopleSearch } from '../components/discover/PeopleSearch';
import { PublicationSearch } from '../components/discover/PublicationSearch';
import { useAsync } from '../hooks';
import type { ExternalAuthor } from '../types';

/**
 * Find research: search OpenAlex (people + papers) and Crossref (papers),
 * defaulting to our own university so its faculty show up first.
 */
export function FindResearchPage() {
  const { data: config, loading } = useAsync(() => api<{ institution: string | null }>('/discover/config'), []);
  const [tab, setTab] = useState<'people' | 'publications'>('people');
  const [author, setAuthor] = useState<ExternalAuthor | null>(null);

  return (
    <section>
      <div className="page-head">
        <div className="page-title-group">
          <span className="eyebrow">Scholarly Discovery</span>
          <h1>Find research</h1>
          <p className="page-subtitle">Explore researchers and publications across OpenAlex and Crossref.</p>
        </div>
      </div>

      <div className="tabs" role="tablist" aria-label="Search type">
        <button
          role="tab"
          aria-selected={tab === 'people'}
          className={tab === 'people' ? 'tab active' : 'tab'}
          onClick={() => setTab('people')}
        >
          <UsersIcon size={15} />
          <span>People</span>
        </button>
        <button
          role="tab"
          aria-selected={tab === 'publications'}
          className={tab === 'publications' ? 'tab active' : 'tab'}
          onClick={() => setTab('publications')}
        >
          <BookOpenIcon size={15} />
          <span>Publications</span>
        </button>
      </div>

      <p className="info-strip">
        <InfoIcon size={15} />
        <span>
          Searches <a href="https://openalex.org" target="_blank" rel="noopener noreferrer">OpenAlex</a> and{' '}
          <a href="https://www.crossref.org" target="_blank" rel="noopener noreferrer">Crossref</a>, two free open catalogues of scholarly work.
          Automatic author matching can mix up people with similar names, so papers are only added to an account after review.
        </span>
      </p>

      {loading ? (
        <LoadingState />
      ) : tab === 'people' ? (
        // Keep the people list mounted while a profile is open, so "Back" returns to the same page of results.
        <>
          <div hidden={Boolean(author)}>
            <PeopleSearch institution={config?.institution ?? null} onOpen={setAuthor} />
          </div>
          {author && <AuthorWorks key={author.id} author={author} onBack={() => setAuthor(null)} />}
        </>
      ) : (
        <PublicationSearch institution={config?.institution ?? null} />
      )}
    </section>
  );
}
