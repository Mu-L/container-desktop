/* eslint-disable jsx-a11y/no-autofocus */
import { Alignment, Button, ButtonGroup, Classes, Divider, InputGroupProps, Intent, MenuItem } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { ItemRenderer, Select } from "@blueprintjs/select";
import classNames from "classnames";
import React, { useCallback } from "react";
import { useTranslation } from "react-i18next";

import { Connector, ContainerEngine } from "@/env/Types";

import { RestrictedTo } from "@/web-app/components/RestrictedTo";
import "./EngineSelect.css";

// EngineSelect

const renderConnector: ItemRenderer<Connector> = (item, { handleClick, handleFocus, modifiers, query }) => {
  if (!modifiers.matchesPredicate) {
    return null;
  }
  const isDisabled = modifiers.disabled || item.disabled || !item.availability.enabled;
  return (
    <MenuItem
      className="EngineSelectMenuItem"
      active={modifiers.active}
      disabled={isDisabled}
      key={item.engine}
      labelElement={(<RestrictedTo engine={item.engine} />) as any}
      onClick={handleClick}
      onFocus={handleFocus}
      roleStructure="listoption"
      text={item.label}
      title={isDisabled ? item.notes : ""}
    />
  );
};

export interface EngineSelectProps {
  items: Connector[];
  inputProps: Partial<Omit<InputGroupProps, "value" | "onChange">>;
  engine?: ContainerEngine;
  disabled?: boolean;
  pending?: boolean;
  withoutDetect?: boolean;
  onChange?: (item: ContainerEngine, event?: React.SyntheticEvent<HTMLElement>) => void;
  onDetect?: (item: ContainerEngine, event?: React.MouseEvent<HTMLElement, MouseEvent>) => void;
}

export const EngineSelect: React.FC<EngineSelectProps> = ({ items, inputProps, disabled, pending, withoutDetect, engine, onChange, onDetect }: EngineSelectProps) => {
  const { t } = useTranslation();
  const activeItem = engine ? items.find((it) => it.engine === engine) : undefined;
  const onItemSelect = useCallback(
    (e: any) => {
      onChange?.(e.engine);
    },
    [onChange]
  );
  const onItemDetect = useCallback(
    (e: any) => {
      if (activeItem) {
        onDetect?.(activeItem.engine, e);
      }
    },
    [onDetect, activeItem]
  );
  return (
    <div className="ConnectionEntitySelect EngineSelect">
      <Select<Connector>
        filterable={false}
        fill
        resetOnSelect
        scrollToActiveItem
        inputProps={inputProps}
        items={items}
        itemRenderer={renderConnector}
        onItemSelect={onItemSelect}
        popoverProps={{ matchTargetWidth: true, minimal: true }}
        activeItem={activeItem}
      >
        <Button
          alignText={Alignment.LEFT}
          disabled={disabled}
          fill
          rightIcon={IconNames.CARET_DOWN}
          title={activeItem?.description}
          text={activeItem?.label ?? t("-- Select --")}
          textClassName={classNames({
            [Classes.TEXT_MUTED]: activeItem === undefined
          })}
        />
      </Select>
      {withoutDetect ? null : (
        <>
          <Divider />
          <ButtonGroup minimal>
            <Button disabled={pending} small text={t("Detect")} intent={Intent.SUCCESS} onClick={onItemDetect} />
          </ButtonGroup>
        </>
      )}
    </div>
  );
};