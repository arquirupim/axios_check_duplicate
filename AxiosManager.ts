import { AxiosResponse, InternalAxiosRequestConfig } from 'axios';

type BaseProgress = {
    // 요청 보내는 url
    url: InternalAxiosRequestConfig['url'];
    // 요청 보내는 params의 JSON형식
    params: ReturnType<JSON['stringify']> | undefined;
    // 요청 보내는 시점의 Date.now() 값
    time: number;
    //요청 취소용도의 AbortController
    controller: AbortController;
    //최초 중복아닌 요청의 JSON 데이터
    data?: string;
};
type DupliacateEl = {
    /**
     * progressQueue에 있는 request의 time값
     * time값과 progressId가 일치하면 해당 progress에 대한 중복 건으로 확인
     */
    progressId: BaseProgress['time'];
    // duplicate request를 다시 진행시키는 resolve
    resolve: (value: unknown) => void;
};

// payload, formData에서 정상처리 확인함
export default class AxiosManager {
    // 이전에 진행했던 고유한 요청들의 리스트
    private progressQueue: Array<BaseProgress>;
    // 중복 처리로 판단된 요청들의 리스트
    private duplicateQueue: Array<DupliacateEl>;

    constructor() {
        // axios instance생성시 초기화 및 생성
        this.progressQueue = [];
        this.duplicateQueue = [];
    }
    private pushProgressStack(request: InternalAxiosRequestConfig, abortController: AbortController) {
        this.progressQueue.push({
            url: request.url,
            params: JSON.stringify(request.params),
            time: Date.now(),
            controller: abortController,
        });
    }
    private pushDuplicateStack(request: InternalAxiosRequestConfig) {
        /**
         * promise에 await을 붙이면 resolve전까지 다음 코드가 실행되지 않음
         * 따라서 return new Promise(async function의 return과 같은 타입)를 통해
         * duplicateQueue에 중복건수를 밀어넣고 onResponse에서 정상 통신이 resolve처리를 해줄동안 대기함
         */
        return new Promise((resolve) => {
            const progressIndex = this.getProgressIndex(request.params, request.url);
            this.duplicateQueue.push({
                progressId: this.progressQueue[progressIndex].time,
                resolve,
            });
        });
    }
    private getProgressIndex(param: InternalAxiosRequestConfig['params'], url: InternalAxiosRequestConfig['url']) {
        let index: number = 0;
        if (param !== undefined) {
            //queryString이면 param이 없음
            index = this.progressQueue.findIndex((progress) => progress.url === url);
        } else {
            index = this.progressQueue.findIndex((progress) => progress.params === JSON.stringify(param) && progress.url === url);
        }
        return index;
    }
    private isDuplicate(request: InternalAxiosRequestConfig) {
        const params = JSON.stringify(request.params);
        const url = request.url;
        const targetIndex = this.getProgressIndex(params, url);
        const target = this.progressQueue[targetIndex];
        const now = Date.now();
        if (target !== undefined && now - target.time <= 2000) {
            /**
             * 이전 요청중 같은 url로 n초이내에 요청했었다면 중복 클릭으로 이해하고 취소시킴
             */
            return true;
        } else {
            return false;
        }
    }

    async attachAbortController(request: InternalAxiosRequestConfig) {
        const abortController = new AbortController();
        request.signal = abortController.signal;
        if (this.isDuplicate(request)) {
            //만약 중복된 건이라면 abort(취소)시킴
            abortController.abort();
            await this.pushDuplicateStack(request);
        } else {
            this.pushProgressStack(request, abortController);
        }
        return request;
    }
    onResponse(response: AxiosResponse) {
        const index = this.getProgressIndex(response.config.params, response.config.url);
        const { time: id } = this.progressQueue[index];
        this.progressQueue[index].data = JSON.stringify(response.data);
        if (this.duplicateQueue.length > 0) {
            // 중복되는 건수가 있을경우 해당 요청의 중복건수들에 대하여 resolve하여 다시 동작을 이어감
            const duplicateds = this.duplicateQueue.filter((el) => el.progressId === id);
            duplicateds.forEach((el) => {
                el.resolve(null);
            });
        } else {
            //중복된 건수가 없다는것은 해당 response정보가 필요없으므로 삭제
            this.progressQueue.splice(index, 1);
        }
    }
    getReturnData(request: InternalAxiosRequestConfig) {
        /**
         * 만약 abort되었다면 instance의 ErrorInterceptor에 걸려서 이부분으로 들어오게됨
         * 이때 data가 없다면 에러가뜨므로 맨 처음 정상 통신의 데이터로 바꿔줌
         */
        const index = this.getProgressIndex(request.params, request.url);
        const { data, time: id } = this.progressQueue[index];
        const duplicateEls = this.duplicateQueue.filter((el) => el.progressId === id);

        if (duplicateEls.length === 1) {
            //중복건수가 1개일 경우 기존 보관중인 중복이 아닌 요청을 제거해준다
            this.progressQueue.splice(index, 1);
        }
        const duplicateIndex = this.duplicateQueue.findIndex((el) => el.progressId === id);
        this.duplicateQueue.splice(duplicateIndex, 1);
        return data;
    }
}
