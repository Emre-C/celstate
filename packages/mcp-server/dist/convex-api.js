import { makeFunctionReference, } from "convex/server";
export const celstateApi = {
    generations: {
        getByUserAndIdWithUrls: makeFunctionReference("generations:getByUserAndIdWithUrls"),
        listByUserWithUrls: makeFunctionReference("generations:listByUserWithUrls"),
        requestGeneration: makeFunctionReference("generations:requestGeneration"),
    },
    users: {
        getMe: makeFunctionReference("users:getMe"),
    },
};
