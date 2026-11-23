// Azure DevOps-native buttons used across pages: a dropdown button ("All changes ▾") and split buttons
// ("Approve | ▾"). They wrap azure-devops-ui so look, keyboard handling and menus match the host.
import { MenuButton, MenuItemType, type IMenuItem } from "azure-devops-ui/Menu";
import { SplitButton } from "azure-devops-ui/SplitButton";
import * as React from "react";

export interface MenuOption {
  id: string;
  text: string;
  icon?: string;
  /** Extra class on the icon, e.g. to draw it as a coloured badge. */
  iconClassName?: string;
  secondaryText?: string;
  /**
   * The current value of a picker: a blue marker and highlight. There is no `checked`: azure-devops-ui draws those
   * items as checkboxes that keep the menu open, and its button stays expanded so the next click only closes it.
   */
  selected?: boolean;
  disabled?: boolean;
  /** Renders a divider instead of an item. */
  divider?: boolean;
  onSelect?: () => void;
  /** Makes the item a link; it opens in the whole Azure DevOps page, not the extension's frame. */
  href?: string;
}

let menuIds = 0;
function useMenuId(prefix: string): string {
  return React.useMemo(() => `${prefix}-${++menuIds}`, [prefix]);
}

function toItems(options: MenuOption[]): IMenuItem[] {
  return options.map((o) =>
    o.divider
      ? { id: o.id, itemType: MenuItemType.Divider }
      : {
          id: o.id,
          className: o.selected ? "menu-item-selected" : undefined,
          text: o.text,
          secondaryText: o.secondaryText,
          iconProps: o.icon ? { iconName: o.icon, className: o.iconClassName } : undefined,
          disabled: o.disabled,
          href: o.href,
          target: o.href ? "_top" : undefined,
          onActivate: () => o.onSelect?.(),
        },
  );
}

/** A single button with a chevron that opens a menu, like the Files view selectors in Azure DevOps. */
export const DropdownButton: React.FC<{
  text: string;
  icon?: string;
  options: MenuOption[];
  disabled?: boolean;
  subtle?: boolean;
  ariaLabel?: string;
  className?: string;
}> = ({ text, icon, options, disabled, subtle, ariaLabel, className }) => {
  const id = useMenuId("dropdown");
  return (
    <MenuButton
      className={className}
      text={text}
      iconProps={icon ? { iconName: icon } : undefined}
      disabled={disabled}
      subtle={subtle}
      ariaLabel={ariaLabel ?? text}
      contextualMenuProps={{ menuProps: { id, items: toItems(options) } }}
    />
  );
};

/** A primary action with the alternatives behind an attached chevron (the Azure DevOps vote button). */
export const SplitActionButton: React.FC<{
  text: string;
  icon?: string;
  onClick: () => void;
  options: MenuOption[];
  primary?: boolean;
  disabled?: boolean;
  menuLabel: string;
  className?: string;
}> = ({ text, icon, onClick, options, primary, disabled, menuLabel, className }) => {
  const id = useMenuId("split");
  return (
    <SplitButton
      className={className}
      primary={primary}
      disabled={disabled}
      buttonProps={{ text, iconProps: icon ? { iconName: icon } : undefined, onClick }}
      menuButtonProps={{ ariaLabel: menuLabel, contextualMenuProps: { menuProps: { id, items: toItems(options) } } }}
    />
  );
};

/**
 * Icon-only "⋯" menu for comment and row actions; `subtle={false}` for the filled page-header one. `icon` swaps the
 * "⋯" for another icon, as the Files tab's settings gear does.
 */
export const MoreMenu: React.FC<{ label: string; options: MenuOption[]; disabled?: boolean; subtle?: boolean; icon?: string }> = ({
  label,
  options,
  disabled,
  subtle = true,
  icon = "More",
}) => {
  const id = useMenuId("more");
  return (
    <MenuButton
      className="more-menu"
      subtle={subtle}
      hideDropdownIcon
      iconProps={{ iconName: icon }}
      ariaLabel={label}
      disabled={disabled}
      contextualMenuProps={{ menuProps: { id, items: toItems(options) } }}
    />
  );
};
