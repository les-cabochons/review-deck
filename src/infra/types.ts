// What the Infra view knows about a pull request's Terraform changes. Everything here is read from the text of
// the changed .tf files at both sides of the comparison. No plan, no state, no provider call.

export type BlockKind = "resource" | "data" | "module" | "variable" | "local" | "output" | "provider" | "terraform" | "moved" | "removed" | "import" | "check";

export type ChangeStatus = "added" | "removed" | "changed" | "same";

/** One attribute of a block, as its expression's text with comments and alignment left out. `null`: absent on that side. */
export interface AttributeChange {
  /** `kind`, `site_config.application_stack.node_version`, `app_settings.API_KEY`, `notification[1].threshold`. */
  path: string;
  before: string | null;
  after: string | null;
}

/**
 * What applying the change may do to a resource beyond updating it in place. Always a reading of the code, never a
 * fact: only `terraform plan` knows. `reason` says what the reading rests on, and the page shows it as is.
 */
export interface Risk {
  /** `destroy`: the block is gone. `replace`: destroyed and created again. `follows`: uses a resource that is. */
  kind: "destroy" | "replace" | "follows";
  /**
   * `likely`: the code leaves little doubt (a literal value of an argument documented to force a new resource
   * changed; a block was deleted). `possible`: it depends on something the code doesn't show (an expression's
   * value, an exception in the provider's documentation, how the provider treats a dependent).
   */
  certainty: "likely" | "possible";
  reason: string;
  /** The attributes behind a `replace`. */
  attributes?: string[];
  /** The provider documentation a `replace` rests on. */
  docs?: { provider: string; version: string };
  /** The resource a `follows` depends on. */
  cause?: string;
}

/** Something to check that isn't a risk of its own, or that explains why there is none. */
export interface Note {
  level: "warn" | "info";
  text: string;
}

export interface InfraBlock {
  /** `azurerm_storage_account.this`, `data.archive_file.package`, `module.network`, `var.location`, `local.name`, `output.url`. */
  address: string;
  kind: BlockKind;
  /** The resource or data source type (`azurerm_storage_account`). */
  type: string | null;
  name: string;
  /** Where the block is declared (the base side's file if removed). `null`: only referenced, declared in a file the pull request doesn't change. */
  file: string | null;
  /** 1-based line of the block in `file`. */
  line: number | null;
  status: ChangeStatus;
  /** Changed, but only in its `description`. Listed, and left out of the diagram and the counts. */
  docsOnly: boolean;
  changes: AttributeChange[];
  risk: Risk | null;
  notes: Note[];
  /**
   * A module block's `source`, unquoted: `./modules/storage`, `Azure/naming/azurerm`. The head side's, or the base
   * side's if the block is removed. Absent for other blocks, and for a module declared in a file the PR doesn't change.
   */
  source?: string;
}

/** `to` uses `from`: a storage account uses its resource group. */
export interface InfraEdge {
  from: string;
  to: string;
  /** `touched`: on both sides, and an attribute of `to` that holds the reference changed. */
  status: "added" | "removed" | "touched" | "same";
  /** The attributes of `to` that hold the reference. For `touched`, only the changed ones. */
  via: string[];
  /**
   * When `from` is a module: the outputs of it that `to` reads (`queue_name` in `module.storage.queue_name`), the
   * ones a changed line reads first.
   */
  outputs?: string[];
}

/** The changed Terraform files of one directory, which Terraform treats as one module. */
export interface InfraModule {
  /** Repository path of the directory, "" for the root. */
  dir: string;
  files: string[];
  blocks: InfraBlock[];
  edges: InfraEdge[];
  /** Files the grammar couldn't fully parse: their blocks may be missing or wrong. */
  parseErrors: string[];
}

export interface TerraformFile {
  /** Repository path at the head side (the base side's for a deleted file). */
  path: string;
  /** Repository path at the base side, if the file was renamed. */
  oldPath?: string;
  /** `null`: absent on that side. */
  old: string | null;
  new: string | null;
}

/** How many resources, data sources and modules each line of the summary counts. Each block counts once, at its worst. */
export interface InfraSummary {
  destroy: number;
  replace: number;
  follows: number;
  changed: number;
  added: number;
}
