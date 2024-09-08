// vendors
import { Thunk, action, thunk } from "easy-peasy";
// project
import { AppRegistry, ResetableModel } from "@/web-app/domain/types";

export interface TroubleshootModelState {}

export interface TroubleshootModel extends TroubleshootModelState, ResetableModel<TroubleshootModel> {
  // actions
  // thunks
  troubleShootPrune: Thunk<TroubleshootModel>;
  troubleShootReset: Thunk<TroubleshootModel>;
}

export const createModel = async (registry: AppRegistry): Promise<TroubleshootModel> => {
  return {
    reset: action((state) => {}),
    troubleShootPrune: thunk(async (actions) =>
      registry.withPending(async () => {
        const client = await registry.getContainerClient();
        await client.pruneSystem();
      })
    ),
    troubleShootReset: thunk(async (actions) =>
      registry.withPending(async (store) => {
        const client = await registry.getContainerClient();
        await client.resetSystem();
      })
    )
  };
};
