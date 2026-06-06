/// <reference types="svelte-clerk/env" />

declare global {
	namespace App {
		interface Locals {
			requestId: string;
		}
	}
}

export {};
