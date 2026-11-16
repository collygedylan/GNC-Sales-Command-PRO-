async function sendPreparedPhotoToEdge(formData, options) {
    if (!options.singleUploadAttempt) return postPhotoUploadWithTransientRetry(formData, options);
    return postAppFunctionFormData(APP_API_FUNCTION_URL, formData, {...options,label:'Secure photo upload'});
}

async function sendPreparedNativeRowPhoto(formData, options) {
    const nativeForm = new FormData();
    for (const [name,value] of formData) nativeForm.append(name,value);
    nativeForm.set('prefix','lsn-');
    nativeForm.set('masterUid',options.nativeMaster?.UNIQUE_ID || formData.get('masterUid'));
    return uploadDrivePhotoWithNativeSession(nativeForm,{...options,attachPhoto:false});
}

async function sendPreparedRowPhotoUpload(formData, nativeEvidenceUpload, options) {
    const queued = formData.get('prefix')==='req-' && formData.get('requestId') && !formData.get('suspendTagId');
    if (queued && nativeAuthSessionActive) return uploadNativeRequestPhoto(formData,options);
    if (nativeEvidenceUpload) return sendPreparedNativeRowPhoto(formData,options);
    try {
        await ensureAppApiWriteProxySession();
        return await sendPreparedPhotoToEdge(formData,options);
    } catch (error) {
        if (isPasswordChangeRequiredError(error) && await recoverAppApiSessionAfterPasswordRequired(error)) {
            try { return await sendPreparedPhotoToEdge(formData,options); }
            catch (recoveredError) { error = recoveredError; }
        }
        if (!nativeAuthSessionActive || !formData.get('masterUid')) throw error;
        return queued ? uploadNativeRequestPhoto(formData,options) : sendPreparedNativeRowPhoto(formData,options);
    }
}

async function uploadNativeRequestPhoto(formData, options) {
    const owner = getSupabaseReadIdentityScope(), epoch = nativeAuthRecoveryEpoch;
    const current = ()=>owner===getSupabaseReadIdentityScope() && epoch===nativeAuthRecoveryEpoch;
    assertCurrentPhotoUpload(current,options);
    const headers = options.nativeHeaders || await getNativeAuthRequestHeaders(false);
    if (!headers?.Authorization) throw nativeSessionRecoveryError();
    const masterUid = String(formData.get('masterUid') || '');
    const object = await getNativeDrivePhotoObject(formData,'lsn-',masterUid);
    const prepared = requestPhotoStorageObject(object);
    const identity = Object.fromEntries(['masterUid','itemCode','locationCode','lotCode','requestId']
        .map(name=>[name,String(formData.get(name) || '')]));
    const receipt = await supabaseRpc('prepare_request_photo_upload_v3100',{
        p_identity:identity,p_photo_id:String(formData.get('queuedPhotoId') || ''),p_object_path:prepared.filePath
    },{timeoutMs:25000,signal:options.signal});
    if (receipt?.ok!==true || receipt.masterUid!==masterUid || receipt.requestId!==identity.requestId) {
        throw new Error('The request photo row was not confirmed.');
    }
    const send = ([path,blob])=>uploadNativeDrivePhotoPart(prepared.bucketName+'/'+path,blob,headers,current,options);
    await send(prepared.parts.at(-1));
    assertCurrentPhotoUpload(current,options);
    return {ok:true,bucketName:prepared.bucketName,filePath:prepared.filePath,
        publicUrl:SUPABASE_URL+'/storage/v1/object/public/'+prepared.bucketName+'/'+prepared.filePath,
        thumbnailUploads:Promise.allSettled(prepared.parts.slice(0,-1).filter(([,blob])=>blob).map(send))};
}

function requestPhotoStorageObject(object) {
    const filePath='v2/'+object.filePath.split('/').at(-1);
    const parts=object.parts.map(([path,blob])=>[path.includes('_thumbs/') ? path.slice(path.indexOf('_thumbs/')) : filePath,blob]);
    return {...object,bucketName:PHOTO_BUCKETS['req-'],filePath,parts};
}
