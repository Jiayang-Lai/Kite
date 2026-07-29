export type KqlTranslationResult = {
	success: boolean;
	sql: string | null;
	error: string | null;
	render: unknown;
};

export type KqlTranslatorRequest = {
	type: 'translate';
	id: number;
	kql: string;
};

export type KqlTranslatorResponse =
	| {
			type: 'result';
			id: number;
			result: KqlTranslationResult;
	  }
	| {
			type: 'error';
			id: number;
			message: string;
			fatal?: boolean;
	  };
