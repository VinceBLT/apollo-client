import { assign, cloneDeep } from 'lodash';
import gql from 'graphql-tag';

import { mockSingleLink } from '../__mocks__/mockLinks';
import { InMemoryCache } from '../cache/inmemory/inMemoryCache';
import { ApolloClient, NetworkStatus, ObservableQuery } from '../';
import { itAsync } from './utils/itAsync';

describe('updateQuery on a simple query', () => {
  const query = gql`
    query thing {
      entry {
        value
        __typename
      }
      __typename
    }
  `;
  const result = {
    data: {
      __typename: 'Query',
      entry: {
        __typename: 'Entry',
        value: 1,
      },
    },
  };

  itAsync('triggers new result from updateQuery', (resolve, reject) => {
    const link = mockSingleLink(reject, {
      request: { query },
      result,
    });

    const client = new ApolloClient({
      link,
      cache: new InMemoryCache(),
    });

    const obsHandle = client.watchQuery({
      query,
    });

    let lastResult: any = null;
    const sub = obsHandle.subscribe({
      next(queryResult) {
        lastResult = queryResult;
      },
    });

    return new Promise(resolve => setTimeout(resolve, 5))
      .then(() => obsHandle)
      .then((watchedQuery: ObservableQuery<any>) => {
        expect(lastResult.data.entry.value).toBe(1);
        return watchedQuery.updateQuery((prevResult: any) => {
          const res = cloneDeep(prevResult);
          res.entry.value = 2;
          return res;
        });
      })
      .then(() => expect(lastResult.data.entry.value).toBe(2))
      .then(() => sub.unsubscribe())
      .then(resolve, reject);
  });
});

describe('updateQuery on a query with required and optional variables', () => {
  const query = gql`
    query thing($requiredVar: String!, $optionalVar: String) {
      entry(requiredVar: $requiredVar, optionalVar: $optionalVar) {
        value
        __typename
      }
      __typename
    }
  `;
  // the test will pass if optionalVar is uncommented
  const variables = {
    requiredVar: 'x',
    // optionalVar: 'y',
  };
  const result = {
    data: {
      __typename: 'Query',
      entry: {
        __typename: 'Entry',
        value: 1,
      },
    },
  };

  itAsync('triggers new result from updateQuery', (resolve, reject) => {
    const link = mockSingleLink(reject, {
      request: {
        query,
        variables,
      },
      result,
    });

    const client = new ApolloClient({
      link,
      cache: new InMemoryCache(),
    });

    const obsHandle = client.watchQuery({
      query,
      variables,
    });

    let lastResult: any = null;
    const sub = obsHandle.subscribe({
      next(queryResult) {
        // do nothing
        lastResult = queryResult;
      },
    });

    return new Promise(resolve => setTimeout(resolve, 5))
      .then(() => obsHandle)
      .then((watchedQuery: ObservableQuery<any>) => {
        expect(lastResult.data.entry.value).toBe(1);
        return watchedQuery.updateQuery((prevResult: any) => {
          const res = cloneDeep(prevResult);
          res.entry.value = 2;
          return res;
        });
      })
      .then(() => expect(lastResult.data.entry.value).toBe(2))
      .then(() => sub.unsubscribe())
      .then(resolve, reject);
  });
});

describe('fetchMore on an observable query', () => {
  const query = gql`
    query Comment($repoName: String!, $start: Int!, $limit: Int!) {
      entry(repoFullName: $repoName) {
        comments(start: $start, limit: $limit) {
          text
          __typename
        }
        __typename
      }
    }
  `;
  const query2 = gql`
    query NewComments($start: Int!, $limit: Int!) {
      comments(start: $start, limit: $limit) {
        text
        __typename
      }
      __typename
    }
  `;
  const variables = {
    repoName: 'org/repo',
    start: 0,
    limit: 10,
  };
  const variablesMore = assign({}, variables, { start: 10, limit: 10 });
  const variables2 = {
    start: 10,
    limit: 20,
  };

  const result: any = {
    data: {
      __typename: 'Query',
      entry: {
        __typename: 'Entry',
        comments: [],
      },
    },
  };
  const resultMore = cloneDeep(result);
  const result2: any = {
    data: {
      __typename: 'Query',
      comments: [],
    },
  };
  for (let i = 1; i <= 10; i++) {
    result.data.entry.comments.push({
      text: `comment ${i}`,
      __typename: 'Comment',
    });
  }
  for (let i = 11; i <= 20; i++) {
    resultMore.data.entry.comments.push({
      text: `comment ${i}`,
      __typename: 'Comment',
    });
    result2.data.comments.push({
      text: `new comment ${i}`,
      __typename: 'Comment',
    });
  }

  function setup(
    reject: (reason: any) => any,
    ...mockedResponses: any[]
  ) {
    const link = mockSingleLink(
      reject,
      {
        request: {
          query,
          variables,
        },
        result,
      },
      ...mockedResponses,
    );

    const client = new ApolloClient({
      link,
      cache: new InMemoryCache(),
    });

    const observable = client.watchQuery<any>({
      query,
      variables,
    });

    let lastResult: any;
    const sub = observable.subscribe({
      next(queryResult) {
        lastResult = queryResult;
      },
    });

    return {
      link,
      client,
      observable,
      sub,
      getLastResult() {
        return lastResult;
      },
    };
  }

  itAsync('triggers new result withAsync new variables', (resolve, reject) => {
    const { observable, sub, getLastResult } = setup(reject, {
      request: {
        query,
        variables: variablesMore,
      },
      result: resultMore,
    });

    return observable.fetchMore({
      // Rely on the fact that the original variables had limit: 10
      variables: { start: 10 },
      updateQuery: (prev, options) => {
        expect(options.variables).toEqual(variablesMore);
        const state = cloneDeep(prev) as any;
        state.entry.comments = [
          ...state.entry.comments,
          ...(options.fetchMoreResult as any).entry.comments,
        ];
        return state;
      },
    }).then(data => {
      // This is the server result
      expect(data.data.entry.comments).toHaveLength(10);
      expect(data.loading).toBe(false);
      const comments = getLastResult().data.entry.comments;
      expect(comments).toHaveLength(20);
      for (let i = 1; i <= 20; i++) {
        expect(comments[i - 1].text).toEqual(`comment ${i}`);
      }
      sub.unsubscribe();
    }).then(resolve, reject);
  });

  itAsync('basic fetchMore results merging', (resolve, reject) => {
    const { observable, sub, getLastResult } = setup(reject, {
      request: {
        query,
        variables: variablesMore,
      },
      result: resultMore,
    });

    return observable.fetchMore({
      variables: { start: 10 }, // rely on the fact that the original variables had limit: 10
      updateQuery: (prev, options) => {
        const state = cloneDeep(prev) as any;
        state.entry.comments = [
          ...state.entry.comments,
          ...(options.fetchMoreResult as any).entry.comments,
        ];
        return state;
      },
    }).then(data => {
      expect(data.data.entry.comments).toHaveLength(10); // this is the server result
      expect(data.loading).toBe(false);
      const comments = getLastResult().data.entry.comments;
      expect(comments).toHaveLength(20);
      for (let i = 1; i <= 20; i++) {
        expect(comments[i - 1].text).toEqual(`comment ${i}`);
      }
      sub.unsubscribe();
    }).then(resolve, reject);
  });

  itAsync('fetching more with a different query', (resolve, reject) => {
    const { observable, sub, getLastResult } = setup(reject, {
      request: {
        query: query2,
        variables: variables2,
      },
      result: result2,
    });

    return observable.fetchMore({
      query: query2,
      variables: variables2,
      updateQuery: (prev, options) => {
        const state = cloneDeep(prev) as any;
        state.entry.comments = [
          ...state.entry.comments,
          ...(options.fetchMoreResult as any).comments,
        ];
        return state;
      },
    }).then(() => {
      const comments = getLastResult().data.entry.comments;
      expect(comments).toHaveLength(20);
      for (let i = 1; i <= 10; i++) {
        expect(comments[i - 1].text).toEqual(`comment ${i}`);
      }
      for (let i = 11; i <= 20; i++) {
        expect(comments[i - 1].text).toEqual(`new comment ${i}`);
      }
      sub.unsubscribe();
    }).then(resolve, reject);
  });

  itAsync('will set the `network` status to `fetchMore`', (resolve, reject) => {
    const link = mockSingleLink(
      reject,
      { request: { query, variables }, result, delay: 5 },
      {
        request: { query, variables: variablesMore },
        result: resultMore,
        delay: 5,
      },
    );

    const client = new ApolloClient({
      link,
      cache: new InMemoryCache({
        typePolicies: {
          Entry: {
            fields: {
              comments: {
                merge(existing: any[], incoming: any[]) {
                  return [
                    ...existing || [],
                    ...incoming,
                  ];
                },
              },
            },
          },
        },
      }),
    });

    const observable = client.watchQuery({
      query,
      variables,
      notifyOnNetworkStatusChange: true,
    });

    let count = 0;
    observable.subscribe({
      next: ({ data, networkStatus }) => {
        switch (count++) {
          case 0:
            expect(networkStatus).toBe(NetworkStatus.ready);
            expect((data as any).entry.comments.length).toBe(10);
            observable.fetchMore({
              variables: { start: 10 },
            });
            break;
          case 1:
            expect(networkStatus).toBe(NetworkStatus.fetchMore);
            expect((data as any).entry.comments.length).toBe(10);
            break;
          case 2:
            expect(networkStatus).toBe(NetworkStatus.ready);
            expect((data as any).entry.comments.length).toBe(10);
            break;
          case 3:
            expect(networkStatus).toBe(NetworkStatus.ready);
            expect((data as any).entry.comments.length).toBe(20);
            resolve();
            break;
          default:
            reject(new Error('`next` called too many times'));
        }
      },
      error: error => reject(error),
      complete: () => reject(new Error('Should not have completed')),
    });
  });

  itAsync('will not get an error from `fetchMore` if thrown', (resolve, reject) => {
    const fetchMoreError = new Error('Uh, oh!');
    const link = mockSingleLink(
      reject,
      { request: { query, variables }, result, delay: 5 },
      {
        request: { query, variables: variablesMore },
        error: fetchMoreError,
        delay: 5,
      },
    );

    const client = new ApolloClient({
      link,
      cache: new InMemoryCache(),
    });

    const observable = client.watchQuery({
      query,
      variables,
      notifyOnNetworkStatusChange: true,
    });

    let count = 0;
    observable.subscribe({
      next: ({ data, networkStatus }) => {
        switch (count++) {
          case 0:
            expect(networkStatus).toBe(NetworkStatus.ready);
            expect((data as any).entry.comments.length).toBe(10);
            observable
              .fetchMore({
                variables: { start: 10 },
                updateQuery: (prev, options) => {
                  const state = cloneDeep(prev) as any;
                  state.entry.comments = [
                    ...state.entry.comments,
                    ...(options.fetchMoreResult as any).entry.comments,
                  ];
                  return state;
                },
              })
              .catch(e => {
                expect(e.networkError).toBe(fetchMoreError);
              });
            break;
          case 1:
            expect(networkStatus).toBe(NetworkStatus.fetchMore);
            expect((data as any).entry.comments.length).toBe(10);
            break;
          default:
            expect(networkStatus).toBe(NetworkStatus.ready);
            expect((data as any).entry.comments.length).toBe(10);
            resolve();
            break;
        }
      },
      error: () => {
        reject(new Error('`error` called when it wasn’t supposed to be.'));
      },
      complete: () => {
        reject(
          new Error('`complete` called when it wasn’t supposed to be.'),
        );
      },
    });
  });

  itAsync('will not leak fetchMore query', (resolve, reject) => {
    const { client, observable, sub } = setup(reject, {
      request: {
        query,
        variables: variablesMore,
      },
      result: resultMore,
    });

    const beforeQueryCount = Object.keys(
      client.queryManager.queryStore.getStore(),
    ).length;

    return observable.fetchMore({
      variables: { start: 10 }, // rely on the fact that the original variables had limit: 10
      updateQuery: (prev, options) => {
        const state = cloneDeep(prev) as any;
        state.entry.comments = [
          ...state.entry.comments,
          ...(options.fetchMoreResult as any).entry.comments,
        ];
        return state;
      },
    }).then(data => {
      var afterQueryCount = Object.keys(
        client.queryManager.queryStore.getStore(),
      ).length;
      expect(afterQueryCount).toBe(beforeQueryCount);
      sub.unsubscribe();
    }).then(resolve, reject);
  });
});

describe('fetchMore on an observable query with connection', () => {
  const query = gql`
    query Comment($repoName: String!, $start: Int!, $limit: Int!) {
      entry(repoFullName: $repoName, start: $start, limit: $limit)
        @connection(key: "repoName") {
        comments {
          text
        }
      }
    }
  `;
  const transformedQuery = gql`
    query Comment($repoName: String!, $start: Int!, $limit: Int!) {
      entry(repoFullName: $repoName, start: $start, limit: $limit) {
        comments {
          text
          __typename
        }
        __typename
      }
    }
  `;

  const variables = {
    repoName: 'org/repo',
    start: 0,
    limit: 10,
  };
  const variablesMore = assign({}, variables, { start: 10, limit: 10 });

  const result: any = {
    data: {
      __typename: 'Query',
      entry: {
        __typename: 'Entry',
        comments: [],
      },
    },
  };
  const resultMore = cloneDeep(result);

  for (let i = 1; i <= 10; i++) {
    result.data.entry.comments.push({
      text: `comment ${i}`,
      __typename: 'Comment',
    });
  }
  for (let i = 11; i <= 20; i++) {
    resultMore.data.entry.comments.push({
      text: `comment ${i}`,
      __typename: 'Comment',
    });
  }

  function setup(
    reject: (reason: any) => any,
    ...mockedResponses: any[]
  ) {
    const link = mockSingleLink(
      reject,
      {
        request: {
          query: transformedQuery,
          variables,
        },
        result,
      },
      ...mockedResponses,
    );

    const client = new ApolloClient({
      link,
      cache: new InMemoryCache(),
    });

    const observable = client.watchQuery<any>({
      query,
      variables,
    });

    let lastResult: any;
    const sub = observable.subscribe({
      next(queryResult) {
        lastResult = queryResult;
      },
    });

    return {
      link,
      client,
      observable,
      sub,
      getLastResult() {
        return lastResult;
      },
    };
  }

  itAsync('fetchMore with connection results merging', (resolve, reject) => {
    const { observable, sub, getLastResult } = setup(reject, {
      request: {
        query: transformedQuery,
        variables: variablesMore,
      },
      result: resultMore,
    });

    return observable.fetchMore({
      variables: { start: 10 }, // rely on the fact that the original variables had limit: 10
      updateQuery: (prev, options) => {
        const state = cloneDeep(prev) as any;
        state.entry.comments = [
          ...state.entry.comments,
          ...(options.fetchMoreResult as any).entry.comments,
        ];
        return state;
      },
    }).then(data => {
      expect(data.data.entry.comments).toHaveLength(10); // this is the server result
      expect(data.loading).toBe(false);
      const comments = getLastResult().data.entry.comments;
      expect(comments).toHaveLength(20);
      for (let i = 1; i <= 20; i++) {
        expect(comments[i - 1].text).toBe(`comment ${i}`);
      }
      sub.unsubscribe();
    }).then(resolve, reject);
  });

  itAsync('will set the network status to `fetchMore`', (resolve, reject) => {
    const link = mockSingleLink(
      reject,
      { request: { query: transformedQuery, variables }, result, delay: 5 },
      {
        request: { query: transformedQuery, variables: variablesMore },
        result: resultMore,
        delay: 5,
      },
    );

    const client = new ApolloClient({
      link,
      cache: new InMemoryCache(),
    });

    const observable = client.watchQuery({
      query,
      variables,
      notifyOnNetworkStatusChange: true,
    });

    let count = 0;
    observable.subscribe({
      next: ({ data, networkStatus }) => {
        switch (count++) {
          case 0:
            expect(networkStatus).toBe(NetworkStatus.ready);
            expect((data as any).entry.comments.length).toBe(10);
            observable.fetchMore({
              variables: { start: 10 },
              updateQuery: (prev, options) => {
                const state = cloneDeep(prev) as any;
                state.entry.comments = [
                  ...state.entry.comments,
                  ...(options.fetchMoreResult as any).entry.comments,
                ];
                return state;
              },
            });
            break;
          case 1:
            expect(networkStatus).toBe(NetworkStatus.fetchMore);
            expect((data as any).entry.comments.length).toBe(10);
            break;
          case 2:
            expect(networkStatus).toBe(NetworkStatus.ready);
            expect((data as any).entry.comments.length).toBe(10);
            break;
          case 3:
            expect(networkStatus).toBe(NetworkStatus.ready);
            expect((data as any).entry.comments.length).toBe(20);
            resolve();
            break;
          default:
            reject(new Error('`next` called too many times'));
        }
      },
      error: error => reject(error),
      complete: () => reject(new Error('Should not have completed')),
    });
  });

  itAsync('will not get an error from `fetchMore` if thrown', (resolve, reject) => {
    const fetchMoreError = new Error('Uh, oh!');
    const link = mockSingleLink(
      reject,
      { request: { query: transformedQuery, variables }, result, delay: 5 },
      {
        request: { query: transformedQuery, variables: variablesMore },
        error: fetchMoreError,
        delay: 5,
      },
    );

    const client = new ApolloClient({
      link,
      cache: new InMemoryCache(),
    });

    const observable = client.watchQuery({
      query,
      variables,
      notifyOnNetworkStatusChange: true,
    });

    let count = 0;
    observable.subscribe({
      next: ({ data, networkStatus }) => {
        switch (count++) {
          case 0:
            expect(networkStatus).toBe(NetworkStatus.ready);
            expect((data as any).entry.comments.length).toBe(10);
            observable
              .fetchMore({
                variables: { start: 10 },
                updateQuery: (prev, options) => {
                  const state = cloneDeep(prev) as any;
                  state.entry.comments = [
                    ...state.entry.comments,
                    ...(options.fetchMoreResult as any).entry.comments,
                  ];
                  return state;
                },
              })
              .catch(e => {
                expect(e.networkError).toBe(fetchMoreError);
              });
            break;
          case 1:
            expect(networkStatus).toBe(NetworkStatus.fetchMore);
            expect((data as any).entry.comments.length).toBe(10);
            break;
          default:
            expect(networkStatus).toBe(NetworkStatus.ready);
            expect((data as any).entry.comments.length).toBe(10);
            resolve();
        }
      },
      error: () => {
        reject(new Error('`error` called when it wasn’t supposed to be.'));
      },
      complete: () => {
        reject(
          new Error('`complete` called when it wasn’t supposed to be.'),
        );
      },
    });
  });
});