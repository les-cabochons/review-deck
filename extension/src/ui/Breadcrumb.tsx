import { Icon } from "azure-devops-ui/Icon";
import * as React from "react";

/** The PR page's top line: back to the hub, repository and number, and the native Azure DevOps page. */
export const Breadcrumb: React.FC<{ onBack: () => void; repo?: string; id?: number; nativeUrl?: string | null }> = ({ onBack, repo, id, nativeUrl }) => (
  <nav className="breadcrumb" aria-label="Breadcrumb">
    <button className="crumb-link" onClick={onBack}>
      <Icon iconName="Back" /> Pull requests
    </button>
    {repo && (
      <>
        <span className="crumb-sep">/</span>
        <span className="crumb">{repo}</span>
      </>
    )}
    {id !== undefined && (
      <>
        <span className="crumb-sep">/</span>
        <span className="crumb">!{id}</span>
      </>
    )}
    <span className="spacer" />
    {nativeUrl && (
      <a className="crumb-link" href={nativeUrl} target="_top">
        Classic review <Icon iconName="NavigateExternalInline" />
      </a>
    )}
  </nav>
);
