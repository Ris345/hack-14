/** The signed-in user. Shared by the API routes and the client page. */
export type User = {
  sub: string;
  email: string;
  name: string;
  picture: string | null;
};
