import type { Schema } from './database-contract-runtime.ts';
const text = {schema:'string'} as const;
export const photoOperationArgs = {
    prepare_request_photo_upload_v3100:{object:{p_identity:{schema:'json'},p_photo_id:text,p_object_path:text}},
    authorize_photo_upload_v3074:{object:{p_actor_id:text,p_actor_username:text,p_prefix:text,
        p_identity:{schema:'json'},p_session_id:{schema:{oneOf:['string','null']},optional:true},
        p_app_issued_at:{schema:{oneOf:['number','null']},optional:true}}},
    authorize_request_photo_intent_v3079:{object:{p_actor_id:text,p_actor_username:text,p_session_id:text,
        p_identity:{schema:'json'},p_photo_id:text,p_object_path:text}},
    append_request_photo_intent_v3079:{object:{p_request_id:text,p_photo_id:text,p_url:text,p_name:text}},
} as const satisfies Record<string,Schema>;
export type PhotoOperation = keyof typeof photoOperationArgs;
export function isPhotoOperation(name:string):name is PhotoOperation {
    return Object.hasOwn(photoOperationArgs,name);
}
