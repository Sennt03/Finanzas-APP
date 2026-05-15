type NotificationFunction = (message: string, title: string) => void;
type OptionsNames = 'closeButton' | 'debug' | 'newestOnTop' | 'progressBar' | 'positionClass' | 'preventDuplicates' | 'onclick' | 'showDuration' | 'hideDuration' | 'timeOut' | 'extendedTimeOut' | 'showEasing' | 'hideEasing' | 'showMethod' | 'hideMethod';
type positionsClass = 'toast-top-right' | 'toast-bottom-right' | 'toast-bottom-left' | 'toast-top-left' | 'toast-top-full-width' | 'toast-bottom-full-width' | 'toast-top-center' | 'toast-bottom-center';

interface Options {
    closeButton: boolean,
    debug: boolean,
    newestOnTop: boolean,
    progressBar: boolean,
    positionClass: positionsClass,
    preventDuplicates: boolean,
    onclick: boolean | null,
    showDuration: number,
    hideDuration: number,
    timeOut: number,
    extendedTimeOut: number,
    showEasing: string,
    hideEasing: string,
    showMethod: string,
    hideMethod: string
}

declare const toastr: {
    error: NotificationFunction,
    success: NotificationFunction,
    warning: NotificationFunction,
    info: NotificationFunction,
    options: Options,
    setOption: (option: OptionsNames, value: string | number) => void,
    setDefaultsOptions: () => void,
    clear: () => void
};

const optionsDefault: Options = {
    closeButton: true,
    debug: false,
    newestOnTop: true,
    progressBar: true,
    positionClass: 'toast-top-right',
    preventDuplicates: false,
    onclick: null,
    showDuration: 300,
    hideDuration: 1000,
    timeOut: 5000,
    extendedTimeOut: 1000,
    showEasing: 'swing',
    hideEasing: 'linear',
    showMethod: 'fadeIn',
    hideMethod: 'fadeOut'
};
toastr.options = Object.assign({}, optionsDefault);

function setOption(option: OptionsNames, value: any) {
    toastr.options = { ...optionsDefault };
    toastr.options[option] = value as never;
}

function setDefaultsOptions() {
    toastr.options = Object.assign({}, optionsDefault);
}

function clear() {
    const toastContainers = document.querySelectorAll('.toast');
    toastContainers.forEach(container => container.remove());
}

toastr.setOption = setOption;
toastr.setDefaultsOptions = setDefaultsOptions;
toastr.clear = clear;

export default toastr;
