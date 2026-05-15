export interface LsUser {
    _id: string,
    username: string,
    email: string
}

export const LsUserDefault: LsUser = {
    _id: '',
    username: '',
    email: ''
}

export type LsField = 'username' | 'email'
