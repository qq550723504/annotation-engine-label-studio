/**
 * Label Studio Modal wrapper
 *
 * This file provides backward compatibility by wrapping @humansignal/ui Modal
 * with LS-specific providers automatically injected.
 */
import type { ReactElement, ReactNode } from "react";
import {
  modal as coreModal,
  confirm as coreConfirm,
  info as coreInfo,
  type ModalProps,
  type ModalUpdateProps,
  type ExtraProps,
} from "@humansignal/ui/lib/modal";
import { ApiProvider } from "../../providers/ApiProvider";
import { AuthProvider } from "@humansignal/core/providers/AuthProvider";
import { ConfigProvider } from "../../providers/ConfigProvider";
import { ToastProvider } from "@humansignal/ui/lib/toast/toast";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "../../utils/query-client";
import { appLocaleRuntime } from "../../providers/AppLocaleRuntime";
import { getAntdLocale, useLocaleTranslation } from "@humansignal/i18n";
import { ConfigProvider as AntdConfigProvider } from "antd";
import { ModalCloseButton } from "@humansignal/ui/lib/modal/ModalCloseButton";

export type { ButtonProps as ButtonVariant } from "@humansignal/ui/lib/button/button";

const ModalLocaleAdapter = ({ children }: { children?: ReactNode }) => {
  const { locale } = useLocaleTranslation("common");
  return <AntdConfigProvider locale={getAntdLocale(locale)}>{children}</AntdConfigProvider>;
};

const AppModalCloseButton = () => {
  const { t } = useLocaleTranslation("common");
  return <ModalCloseButton label={t("closeModal")} />;
};

/**
 * Get the default LS providers for modals
 */
const getDefaultProviders = (): ReactElement[] => {
  return [
    <ModalLocaleAdapter key="antd-locale" />,
    <ConfigProvider key="config" />,
    <ToastProvider key="toast" />,
    <ApiProvider key="api" />,
    <AuthProvider key="auth" />,
    <QueryClientProvider key="query" client={queryClient} />,
  ];
};

const modalTypes = {
  modal: coreModal,
  confirm: coreConfirm,
  info: coreInfo,
} as const;

const createModal = (type: keyof typeof modalTypes) => {
  return <T,>(props: ModalProps<T> & ExtraProps): ModalUpdateProps<T> => {
    const AppLocaleProvider = appLocaleRuntime.provider;
    // Every app modal needs locale context for its close control, including
    // simple modals and callers that replace the default provider list.
    const providers = [
      <AppLocaleProvider key="locale" />,
      ...(props.simple ? [] : (props.providers ?? getDefaultProviders())),
    ];
    return modalTypes[type]({
      closeButton: <AppModalCloseButton />,
      ...props,
      // The core `simple` flag discards providers. The reduced provider list
      // above preserves its no-API behavior while retaining locale context.
      simple: false,
      providers,
    });
  };
};

// Re-export Modal component and hooks
export const modal = createModal("modal");
export const confirm = createModal("confirm");
export const info = createModal("info");
export { modal as standaloneModal };
export { Modal, useModalControls } from "@humansignal/ui/lib/modal";
